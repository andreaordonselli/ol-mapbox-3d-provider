// Generic TILE worker for Mapbox/MapLibre style tile rasterization.
//
// This worker produces ONE product: a composed tile ImageBitmap for a z/x/y
// request. Point-label collection and whole-view declutter moved to
// lib/ol-mapbox-label-worker.js; this worker only strips point labels (and
// their icon siblings) from the bitmap so the globes can draw them as
// billboards, and leaves LINE labels (street / river names) baked into the
// tile exactly as ol-mapbox-style draws them.
//
// Point-label data is collected here ONLY when the caller explicitly asks for
// it (data.labels === true, the tile-mode getLabels API). The default imagery
// path never pays for that work, which keeps tile composition fast during
// panning/zooming.

importScripts('ol/ol.js', 'ol-mapbox-style/olms.js');

var worldExtent = 20037508.342789244;
var projectionCode = 'EPSG:3857';
var canvas;
var map;
var appliedStyle;
var appliedStyleUrl;
var canceledIds = {};
var activeRequestId = null;
var requestStack = [];
var processingRequest = false;
// Labels collected for the CURRENT tile when data.labels === true.
var currentLabels = [];
var currentLabelKeys = {};
var labelWrappingDone = false;
// Optional source-layer (mvt:layer) filter for the CURRENT tile being drawn.
var currentTileLayers = null;
// Optional source-layer filter for which LINE labels are baked into the tile
// bitmap (and the master on/off switch).
var currentLabelLayers = null;
var currentLabelsEnabled = true;
// When true (tile-mode getLabels), point labels are ALSO collected and
// decluttered during this tile render. The imagery fast path leaves it false.
var currentCollectLabels = false;
// Zoom level of the CURRENT tile being rendered (stamped onto collected labels).
var currentTileZoom = 0;
var wrappedVectorLayers = [];
// Count of vector/raster tiles currently loading in the OpenLayers map.
var pendingTileLoads = 0;
var loadTrackingReady = false;
// Holds the current label's declutter priority while the wrapped style
// function runs, so describeLabel can read it without an extra argument.
var stylePriority = 0;

function tileExtent(z, x, y) {
  var tileCount = Math.pow(2, z);
  var tileWidth = (worldExtent * 2) / tileCount;
  var minX = -worldExtent + x * tileWidth;
  var maxX = minX + tileWidth;
  var maxY = worldExtent - y * tileWidth;
  var minY = maxY - tileWidth;
  return [minX, minY, maxX, maxY];
}

function tileCenter(extent) {
  return [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2];
}

function workerLog(enabled, message) {
  if (enabled) {
    console.log('[ol-mapbox-worker] ' + message);
  }
}

function isCanceled(id) {
  if (canceledIds[id]) {
    delete canceledIds[id];
    return true;
  }
  return false;
}

// Returns the [lon, lat] ANCHOR of a feature geometry, or null when
// unavailable.
function featureLonLat(feature) {
  var geometry = feature.getGeometry();
  if (!geometry) {
    return null;
  }
  var type = geometry.getType ? geometry.getType() : '';
  var coord = null;
  if (type === 'Point') {
    var flat = geometry.getFlatCoordinates && geometry.getFlatCoordinates();
    if (flat && flat.length >= 2) {
      coord = [flat[0], flat[1]];
    }
  } else if (type === 'LineString' || type === 'MultiLineString') {
    if (typeof geometry.getCoordinateAt === 'function') {
      var mid = geometry.getCoordinateAt(0.5);
      if (mid && mid.length >= 2) {
        coord = [mid[0], mid[1]];
      }
    }
    if (!coord) {
      var flat2 = geometry.getFlatCoordinates && geometry.getFlatCoordinates();
      if (flat2 && flat2.length >= 2) {
        coord = [flat2[0], flat2[1]];
      }
    }
  } else {
    var ip = null;
    if (typeof geometry.getInteriorPoint === 'function') {
      try {
        ip = geometry.getInteriorPoint();
      } catch (e) {
        ip = null;
      }
    }
    if (ip && ip.getFlatCoordinates) {
      var ipf = ip.getFlatCoordinates();
      if (ipf && ipf.length >= 2) {
        coord = [ipf[0], ipf[1]];
      }
    }
    if (!coord) {
      var flat3 = geometry.getFlatCoordinates && geometry.getFlatCoordinates();
      if (flat3 && flat3.length >= 2) {
        coord = [flat3[0], flat3[1]];
      }
    }
  }
  return coord ? ol.proj.toLonLat(coord) : null;
}

// Extracts the font size (in px) from an ol/style/Text font string.
function fontPixelSize(font) {
  if (!font) {
    return null;
  }
  var match = /([\d.]+)px/.exec(font);
  return match ? parseFloat(match[1]) : null;
}

// Normalizes an ol/style color (string OR [r,g,b,a] array) to a CSS color.
function colorToString(color) {
  if (color === null || color === undefined) {
    return null;
  }
  if (typeof color === 'string') {
    return color;
  }
  if (Array.isArray(color)) {
    if (color.length === 4) {
      return 'rgba(' + Math.round(color[0]) + ',' + Math.round(color[1]) + ',' +
        Math.round(color[2]) + ',' + color[3] + ')';
    }
    if (color.length === 3) {
      return 'rgb(' + Math.round(color[0]) + ',' + Math.round(color[1]) + ',' +
        Math.round(color[2]) + ')';
    }
  }
  return String(color);
}

// Describes the icon (image style) attached to a point label, so the globe can
// draw a small anchor dot where the label is placed. null = plain text label.
function describeIcon(imageStyle) {
  if (!imageStyle) {
    return null;
  }
  try {
    if (typeof imageStyle.getRadius === 'function') {
      var radius = imageStyle.getRadius();
      var fill = imageStyle.getFill ? imageStyle.getFill() : null;
      var fillColor = fill && fill.getColor ? fill.getColor() : null;
      return { color: colorToString(fillColor), size: radius ? Number(radius) : 4 };
    }
    if (typeof imageStyle.getSrc === 'function') {
      var width = imageStyle.getWidth ? imageStyle.getWidth() : null;
      var tint = imageStyle.getColor ? imageStyle.getColor() : null;
      return { color: colorToString(tint), size: width ? Number(width) / 2 : 4 };
    }
    return { color: null, size: 4 };
  } catch (e) {
    return null;
  }
}

// Returns the tangent direction (in radians, Web-Mercator space) of a LINE
// geometry at its midpoint anchor. Kept for the tile-mode getLabels API.
function lineAnchorBearing(feature) {
  var geometry = feature.getGeometry();
  if (!geometry) {
    return null;
  }
  var type = geometry.getType ? geometry.getType() : '';
  if (type !== 'LineString' && type !== 'MultiLineString') {
    return null;
  }
  var coords = null;
  if (typeof geometry.getCoordinates === 'function') {
    if (type === 'LineString') {
      coords = geometry.getCoordinates();
    } else if (type === 'MultiLineString') {
      var all = geometry.getCoordinates();
      var best = null;
      var bestLen = -1;
      for (var i = 0; i < all.length; i += 1) {
        if (all[i] && all[i].length > bestLen) {
          bestLen = all[i].length;
          best = all[i];
        }
      }
      coords = best;
    }
  } else if (typeof geometry.getFlatCoordinates === 'function') {
    var flat = geometry.getFlatCoordinates();
    var stride = typeof geometry.getStride === 'function' ? geometry.getStride() : 2;
    if (flat && flat.length >= stride * 2) {
      coords = [];
      for (var c = 0; c + 1 < flat.length; c += stride) {
        coords.push([flat[c], flat[c + 1]]);
      }
    }
  }
  if (!coords || coords.length < 2) {
    return null;
  }
  var segments = [];
  var total = 0;
  for (var s = 0; s < coords.length - 1; s += 1) {
    var dx = coords[s + 1][0] - coords[s][0];
    var dy = coords[s + 1][1] - coords[s][1];
    var len = Math.sqrt(dx * dx + dy * dy);
    segments.push({ dx: dx, dy: dy, len: len });
    total += len;
  }
  if (total <= 0) {
    return null;
  }
  var target = total / 2;
  var acc = 0;
  for (var w = 0; w < segments.length; w += 1) {
    if (target <= acc + segments[w].len) {
      if (segments[w].dx || segments[w].dy) {
        return Math.atan2(segments[w].dy, segments[w].dx);
      }
      return null;
    }
    acc += segments[w].len;
  }
  var last = segments[segments.length - 1];
  if (last && (last.dx || last.dy)) {
    return Math.atan2(last.dy, last.dx);
  }
  return null;
}

// Returns a serializable plain object describing an ol/style/Text label
// (tile-mode getLabels API). `icon` is the anchor dot marker, or null.
function describeLabel(feature, text, layerName, icon) {
  var fill = text.getFill && text.getFill();
  var fillColor = fill && fill.getColor ? fill.getColor() : null;
  var stroke = text.getStroke && text.getStroke();
  var strokeColor = stroke && stroke.getColor ? stroke.getColor() : null;
  var strokeWidth = stroke && stroke.getWidth ? stroke.getWidth() : null;
  var scale = text.getScale ? text.getScale() : null;
  var font = text.getFont ? text.getFont() : null;
  var fontPx = fontPixelSize(font);
  var properties = feature.getProperties ? feature.getProperties() : {};
  var featureId = properties.id || (properties.osm_id !== undefined ? properties.osm_id : null);
  return {
    id: featureId,
    coordinate: featureLonLat(feature),
    text: text.getText ? text.getText() : null,
    // Full CSS font string ('normal 400 12px/1.2 "Noto Sans",sans-serif').
    font: font,
    // Label fill color (rgba(...) or #hex).
    color: colorToString(fillColor),
    // Halo / outline (Mapbox text-halo-color / text-halo-width).
    haloColor: colorToString(strokeColor),
    haloWidth: strokeWidth !== null && strokeWidth !== undefined ? Number(strokeWidth) : null,
    // Font size in px (parsed from the font string) and its render scale.
    size: fontPx !== null && fontPx !== undefined ? fontPx : null,
    scale: scale !== null && scale !== undefined ? Number(scale) : 1,
    // Offset in pixels (Mapbox text-offset).
    offsetX: text.getOffsetX ? text.getOffsetX() : 0,
    offsetY: text.getOffsetY ? text.getOffsetY() : 0,
    // Alignment (Mapbox text-anchor).
    textAlign: text.getTextAlign ? text.getTextAlign() : null,
    textBaseline: text.getTextBaseline ? text.getTextBaseline() : null,
    // 'point' or 'line' (Mapbox symbol-placement).
    placement: text.getPlacement ? text.getPlacement() : 'point',
    // Rotation in radians (Mapbox text-rotate). 0 when not set.
    rotation: text.getRotation ? text.getRotation() : 0,
    // Whether the label rotates with the view (Mapbox text-rotation-alignment).
    rotateWithView: text.getRotateWithView ? text.getRotateWithView() : false,
    // Direction the road runs at the anchor (Web-Mercator radians). null for
    // point/polygon labels.
    lineAngle: lineAnchorBearing(feature),
    // Declutter priority (higher = drawn first). From the style z-index.
    priority: stylePriority || 0,
    // Anchor dot / icon marker (null = plain text label, no dot).
    icon: icon,
    // The zoom level of the tile this label was collected from.
    zoom: currentTileZoom,
    // Original Mapbox properties kept for filtering (mvt:layer, class, rank...).
    properties: properties
  };
}

// Wraps one vector layer's style function so that during the render pass that
// paints the tile bitmap:
//   - POINT labels are removed (the globe draws them as billboards) and, only
//     when data.labels === true, collected into `currentLabels`;
//   - the icon sibling of a stripped point label is removed too (the globe
//     draws the anchor dot) — icon-ONLY styles (circle POI dots) stay baked;
//   - LINE labels (street names) are LEFT in the style so ol-mapbox-style
//     paints them along the road, controlled by the label filter + switch.
function wrapStyleFunctionForLabels(styleFunction) {
  return function (feature, resolution) {
    var styles = styleFunction(feature, resolution);
    if (!styles) {
      return styles;
    }
    var list = Array.isArray(styles) ? styles : [styles];
    var properties = feature.getProperties ? feature.getProperties() : {};
    var layerName = properties['mvt:layer'] || properties.layer || '';
    // Draw filter: when a layer list is configured, only the requested
    // source-layers are painted into the tile bitmap. null/empty = draw all.
    var drawIt = !currentTileLayers || currentTileLayers.indexOf(layerName) !== -1;
    // Line-label bake filter: bake only when enabled and (when a label filter
    // is configured) only the requested source-layers.
    var bakeLine = currentLabelsEnabled &&
      (!currentLabelLayers || currentLabelLayers.indexOf(layerName) !== -1);
    // Find the feature's icon (on the text style itself or a sibling image
    // style) and whether it has a POINT text label.
    var icon = null;
    var hasPointLabel = false;
    for (var scan = 0; scan < list.length; scan += 1) {
      var scanned = list[scan];
      if (!scanned) {
        continue;
      }
      var scannedImage = scanned.getImage && scanned.getImage();
      if (scannedImage && !icon) {
        icon = describeIcon(scannedImage);
      }
      var scannedText = scanned.getText && scanned.getText();
      if (scannedText && scannedText.getText && scannedText.getText()) {
        var scannedPlacement = scannedText.getPlacement ? scannedText.getPlacement() : 'point';
        if (scannedPlacement !== 'line') {
          hasPointLabel = true;
        }
      }
    }
    var withoutText = [];
    for (var index = 0; index < list.length; index += 1) {
      var style = list[index];
      var text = style.getText && style.getText();
      var label = text && text.getText && text.getText();
      var image = style.getImage && style.getImage();
      if (label) {
        var placement = text.getPlacement ? text.getPlacement() : 'point';
        if (placement === 'line') {
          // Baked line label: keep the whole style (text + icon) so
          // ol-mapbox-style renders it along the line in the tile bitmap.
          if (bakeLine) {
            withoutText.push(style);
          }
          continue;
        }
        // Point label -> billboard. The style function runs on every
        // renderSync pass while waiting for the tile resources, so the same
        // label would be collected many times. Dedupe on layer + text +
        // coordinate. Only done when the caller asked for labels.
        if (currentCollectLabels) {
          var coord = featureLonLat(feature);
          var key = layerName + '|' + label + '|' + (coord ? coord[0] + ',' + coord[1] : 'null');
          if (!currentLabelKeys[key]) {
            currentLabelKeys[key] = true;
            // Declutter priority comes from the OL style's z-index, which
            // ol-mapbox-style sets from the Mapbox layout text-priority.
            stylePriority = (typeof style.getZIndex === 'function' && style.getZIndex() !== null && style.getZIndex() !== undefined)
              ? style.getZIndex() : 0;
            currentLabels.push(describeLabel(feature, text, layerName, icon));
          }
        }
        // Skip this style so the label is NOT drawn into the tile.
        continue;
      }
      if (image && hasPointLabel) {
        // Icon sibling of a stripped point label: the globe draws the anchor
        // dot, so don't bake the icon into the tile (avoids a double icon).
        continue;
      }
      // Non-text style: keep it only when the feature's source-layer is
      // allowed by the current draw filter.
      if (drawIt) {
        withoutText.push(style);
      }
    }
    return Array.isArray(styles) ? withoutText : (withoutText[0] || undefined);
  };
}

// Wraps every vector layer's style function once (after olms.apply). Raster /
// background layers have no style function and are left untouched.
function wrapLayersForLabels() {
  if (labelWrappingDone) {
    return;
  }
  labelWrappingDone = true;
  wrappedVectorLayers.length = 0;
  map.getLayers().forEach(function (layer) {
    if (typeof layer.styleFunction_ === 'function') {
      layer.styleFunction_ = wrapStyleFunctionForLabels(layer.styleFunction_);
      wrappedVectorLayers.push(layer);
    }
  });
  workerLog(true, 'label interception active');
}

// OpenLayers caches each vector layer's rendered canvas keyed by the layer's
// revision number. Bump changed() so a tile requested with a different filter
// actually produces a different bitmap.
function invalidateVectorLayers() {
  for (var i = 0; i < wrappedVectorLayers.length; i += 1) {
    if (typeof wrappedVectorLayers[i].changed === 'function') {
      wrappedVectorLayers[i].changed();
    }
  }
}

// Listen to the map's tile sources and count in-flight tile loads so we can
// wait for them to finish instead of relying on map.getLoadingOrNotReady().
function attachLoadTracking() {
  if (loadTrackingReady) {
    return;
  }
  loadTrackingReady = true;
  map.getLayers().forEach(function (layer) {
    var source = layer.getSource && layer.getSource();
    if (source && typeof source.on === 'function') {
      source.on('tileloadstart', function () {
        pendingTileLoads += 1;
      });
      source.on('tileloadend', function () {
        pendingTileLoads = Math.max(0, pendingTileLoads - 1);
      });
      source.on('tileloaderror', function () {
        pendingTileLoads = Math.max(0, pendingTileLoads - 1);
      });
    }
  });
}

// Bounds each vector source's decoded-tile cache. OpenLayers sizes it at 512
// tiles by default — way too many for a worker that renders one tile at a
// time: zooming through a few levels can accumulate hundreds of decoded MVT
// tiles (tens to hundreds of MB of feature objects) and that is what crashes
// low-RAM devices. The worker rarely reuses source tiles across renders
// beyond a screen's worth at the current zoom, so a small highWaterMark is
// enough for panning while keeping worker memory flat.
function boundSourceCaches(cacheSize) {
  var limit = cacheSize || 48;
  map.getLayers().forEach(function (layer) {
    var source = layer.getSource && layer.getSource();
    if (!source) {
      return;
    }
    var cache = (typeof source.getTileCache === 'function')
      ? source.getTileCache() : source.tileCache_;
    if (cache) {
      cache.highWaterMark = limit;
      if (typeof cache.expireCache === 'function') {
        cache.expireCache();
      }
    }
  });
}

// Applies the SAME declutter logic ol-mapbox-style uses when it renders the
// tile in 2D (tile-mode getLabels API only). Spatial-hash greedy pass.
function declutterLabels(labels, extent, resolutionPx) {
  if (!labels || labels.length < 2) {
    return labels || [];
  }
  var tileWidth = extent[2] - extent[0];
  var tileHeight = extent[3] - extent[1];
  var kept = [];
  var i, j;

  function toPixelX(mercatorX) {
    return (mercatorX - extent[0]) / tileWidth * resolutionPx;
  }
  function toPixelY(mercatorY) {
    return (extent[3] - mercatorY) / tileHeight * resolutionPx;
  }

  var boxes = [];
  for (i = 0; i < labels.length; i += 1) {
    var label = labels[i];
    var coordinate = label.coordinate || [0, 0];
    var mercator = ol.proj.fromLonLat([coordinate[0], coordinate[1]]);
    var size = label.size || 12;
    var scale = label.scale || 1;
    var text = label.text || '';
    var lines = String(text).split('\n');
    var maxLine = 0;
    for (j = 0; j < lines.length; j += 1) {
      maxLine = Math.max(maxLine, lines[j].length);
    }
    var width = Math.max(8, maxLine * size * 0.6) * scale;
    var height = Math.max(10, lines.length * size * 1.2) * scale;
    var anchorX = label.textAlign === 'left' ? 0 : label.textAlign === 'right' ? 1 : 0.5;
    var anchorY = label.textBaseline === 'top' ? 0 : label.textBaseline === 'bottom' ? 1 : 0.5;
    var offsetX = label.offsetX || 0;
    var offsetY = label.offsetY || 0;
    boxes.push({
      label: label,
      priority: label.priority || 0,
      x: toPixelX(mercator[0]) + offsetX - anchorX * width,
      y: toPixelY(mercator[1]) - offsetY - anchorY * height,
      w: width,
      h: height
    });
  }
  boxes.sort(function (a, b) {
    return b.priority - a.priority;
  });

  var maxHeight = 0;
  for (i = 0; i < boxes.length; i += 1) {
    maxHeight = Math.max(maxHeight, boxes[i].h);
  }
  var cellSize = Math.max(24, maxHeight * 2);
  var gridCols = Math.max(1, Math.ceil(resolutionPx / cellSize));
  var grid = new Array(gridCols * gridCols);
  var cellList = [];
  function addCells(box, list) {
    var minCol = Math.max(0, Math.floor(box.x / cellSize));
    var maxCol = Math.min(gridCols - 1, Math.floor((box.x + box.w) / cellSize));
    var minRow = Math.max(0, Math.floor(box.y / cellSize));
    var maxRow = Math.min(gridCols - 1, Math.floor((box.y + box.h) / cellSize));
    for (var row = minRow; row <= maxRow; row += 1) {
      for (var col = minCol; col <= maxCol; col += 1) {
        list.push(row * gridCols + col);
      }
    }
  }

  for (i = 0; i < boxes.length; i += 1) {
    var box = boxes[i];
    cellList.length = 0;
    addCells(box, cellList);
    var overlaps = false;
    for (var c = 0; c < cellList.length && !overlaps; c += 1) {
      var bucket = grid[cellList[c]];
      if (!bucket) {
        continue;
      }
      for (j = 0; j < bucket.length; j += 1) {
        var other = bucket[j];
        if (box.x < other.x + other.w && box.x + box.w > other.x &&
            box.y < other.y + other.h && box.y + box.h > other.y) {
          overlaps = true;
          break;
        }
      }
    }
    if (!overlaps) {
      kept.push(box.label);
      cellList.length = 0;
      addCells(box, cellList);
      for (var g = 0; g < cellList.length; g += 1) {
        var cellIdx = cellList[g];
        if (!grid[cellIdx]) {
          grid[cellIdx] = [];
        }
        grid[cellIdx].push(box);
      }
    }
  }
  return kept;
}

function waitForResources(data) {
  return new Promise(function (resolve) {
    var attempts = 0;
    var finish = function () {
      // Render one final time so every loaded/composed layer is painted on the
      // canvas before it is turned into an ImageBitmap. The two short timeouts
      // are a settle window for async decode events; 15ms each is enough (the
      // previous 30ms+30ms cost ~60ms of pure idle time per tile, which is a
      // lot when a screen needs 20+ tiles).
      setTimeout(function () {
        map.renderSync();
        setTimeout(resolve, 15);
      }, 15);
    };
    var check = function () {
      attempts += 1;
      // Render on the first attempt (kicks off the source-tile fetches) and
      // then only a light periodic kick every ~200ms. Repeatedly calling
      // renderSync while the tiles are still loading re-paints the whole
      // composed style on the worker thread for no visible gain — with a
      // single-worker pool it is the main reason tiles feel slow while
      // panning. finish() does the final full render once the tiles are ready.
      if (attempts === 1 || attempts % 4 === 0) {
        map.renderSync();
      }
      var loading = map.getLoadingOrNotReady() || pendingTileLoads > 0;
      if (attempts % 8 === 0) {
        workerLog(data.log, 'wait attempt=' + attempts + ' pending=' + pendingTileLoads + ' loading=' + loading);
      }
      // The tile is ready only when every source tile has finished loading or
      // failed. Render at least 3 times so the first frame's async fetches are
      // picked up by the load tracking. A tile request is never dropped by a
      // timeout.
      if (!loading && attempts >= 3) {
        finish();
        return;
      }
      // Stuck-tile safety net (~6s): provide whatever has been composed rather
      // than making the globe wait 30s for a tile that will never arrive.
      if (attempts >= 120) {
        workerLog(data.log, 'wait safety cap reached, pending=' + pendingTileLoads);
        finish();
        return;
      }
      setTimeout(check, 50);
    };
    check();
  });
}

function initialize(data) {
  if (!canvas) {
    if (typeof OffscreenCanvas === 'undefined') {
      throw new Error('OffscreenCanvas is not available in this worker; this device cannot render tiles.');
    }
    canvas = new OffscreenCanvas(data.resolution, data.resolution);
    map = new ol.Map({
      target: canvas,
      controls: [],
      interactions: [],
      view: new ol.View({
        projection: projectionCode,
        center: [0, 0],
        zoom: 0
      })
    });
  }
  if (appliedStyle !== data.style || appliedStyleUrl !== data.styleUrl) {
    appliedStyle = data.style;
    appliedStyleUrl = data.styleUrl;
    workerLog(data.log, 'applying style');
    return olms.apply(map, data.style).then(function () {
      workerLog(data.log, 'style applied, layers=' + map.getLayers().getLength());
      attachLoadTracking();
      // Bound the decoded-MVT caches of every vector source: OL's default is
      // 512 tiles, which is how a phone runs out of memory while zooming.
      boundSourceCaches(data.cacheSize);
      // Intercept the style functions once so tiles are rendered WITHOUT
      // baked-in point text (line labels stay baked).
      wrapLayersForLabels();
    }, function (error) {
      workerLog(data.log, 'style apply ERROR: ' + (error && error.message || String(error)));
      throw error;
    });
  }
  return Promise.resolve();
}

function processRequest(data) {
  var id = data.id;
  activeRequestId = id;
  // Fresh label list for this tile (the style functions append to it during
  // the render passes below, only when data.labels === true).
  currentLabels.length = 0;
  currentLabelKeys = {};
  currentTileLayers = data.layers || null;
  currentLabelLayers = data.labelLayers || null;
  currentLabelsEnabled = data.labelsEnabled !== false;
  currentCollectLabels = data.labels === true;
  currentTileZoom = data.z;
  // Force OL to re-render the vector layers with the current layer filter.
  invalidateVectorLayers();
  workerLog(data.log, 'render start ' + data.z + '/' + data.x + '/' + data.y + ' (id ' + id + ')');
  var origExtent = tileExtent(data.z, data.x, data.y);
  var bufferPx = data.bufferPixels || 0;
  var resolutionPx = data.resolution || 256;
  var renderSize = resolutionPx + 2 * bufferPx;
  var resolution = (origExtent[2] - origExtent[0]) / resolutionPx;
  var extent = origExtent;

  if (bufferPx > 0) {
    var origWidth = origExtent[2] - origExtent[0];
    var origHeight = origExtent[3] - origExtent[1];
    var bufferRatio = bufferPx / resolutionPx;
    extent = [
      origExtent[0] - origWidth * bufferRatio,
      origExtent[1] - origHeight * bufferRatio,
      origExtent[2] + origWidth * bufferRatio,
      origExtent[3] + origHeight * bufferRatio
    ];
  }

  initialize(data).then(function () {
    if (isCanceled(id)) { throw new Error('CANCELED'); }
    canvas.width = renderSize;
    canvas.height = renderSize;
    map.setSize([renderSize, renderSize]);
    map.getView().setCenter(tileCenter(extent));
    map.getView().setResolution(resolution);
    return waitForResources(data);
  }).then(function () {
    if (isCanceled(id)) { throw new Error('CANCELED'); }
    workerLog(data.log, 'after wait loading=' + map.getLoadingOrNotReady());
    // Keep the decoded-MVT memory tight after every tile: the LRU auto-evicts
    // at its highWaterMark, expireCache() also drops stale keys immediately.
    boundSourceCaches(data.cacheSize);
    if (bufferPx > 0) {
      return createImageBitmap(canvas, bufferPx, bufferPx, resolutionPx, resolutionPx);
    }
    return createImageBitmap(canvas);
  }).then(function (bitmap) {
    if (isCanceled(id)) {
      bitmap.close();
      throw new Error('CANCELED');
    }
    // Only run the per-tile declutter when the caller asked for labels
    // (tile-mode getLabels). The imagery fast path skips it entirely.
    if (currentCollectLabels && data.declutter !== false) {
      currentLabels = declutterLabels(currentLabels, origExtent, resolutionPx);
    }
    self.postMessage({
      id: id,
      ok: true,
      bitmap: bitmap,
      labels: currentCollectLabels ? currentLabels : [],
      z: data.z,
      x: data.x,
      y: data.y,
      extent: origExtent,
      projection: projectionCode
    }, [bitmap]);
    workerLog(data.log, 'render done ' + data.z + '/' + data.x + '/' + data.y +
      (currentCollectLabels ? ' labels=' + currentLabels.length : ''));
  }).catch(function (error) {
    if (error.message === 'CANCELED') {
      workerLog(data.log, 'render cancel ' + data.z + '/' + data.x + '/' + data.y);
      return;
    }
    workerLog(data.log, 'render error ' + data.z + '/' + data.x + '/' + data.y + ': ' +
      (error.message || String(error)));
    self.postMessage({
      id: id,
      ok: false,
      error: error.message || String(error)
    });
  }).then(function () {
    processingRequest = false;
    activeRequestId = null;
    processNextRequest();
  });
}

function processNextRequest() {
  // Skip canceled requests and drain them from the stack.
  while (requestStack.length > 0) {
    var next = requestStack[requestStack.length - 1];
    if (canceledIds[next.id]) {
      delete canceledIds[next.id];
      requestStack.pop();
      continue;
    }
    break;
  }
  if (processingRequest || requestStack.length === 0) {
    return;
  }
  processingRequest = true;
  // LIFO: most recently requested tiles are most likely still needed.
  processRequest(requestStack.pop());
}

self.onmessage = function (event) {
  var data = event.data;
  if (data.reset) {
    // A source-layer filter changed: drop the collected labels and force the
    // wrapped vector layers to re-compose on the next request.
    currentLabels.length = 0;
    currentLabelKeys = {};
    invalidateVectorLayers();
    return;
  }
  if (data.cancel) {
    // Mark one or more request ids as canceled.
    var ids = Array.isArray(data.cancel) ? data.cancel : [data.cancel];
    for (var i = 0; i < ids.length; i += 1) {
      canceledIds[ids[i]] = true;
    }
    if (!processingRequest) {
      processNextRequest();
    }
    return;
  }
  // Normal tile request: push onto LIFO stack.
  requestStack.push(data);
  workerLog(data.log, 'queued ' + data.z + '/' + data.x + '/' + data.y + ' (id ' + data.id + ', stack ' + requestStack.length + ')');
  // Cancel any pending request for the exact same tile (z/x/y).
  for (var j = requestStack.length - 2; j >= 0; j -= 1) {
    var older = requestStack[j];
    if (older.z === data.z && older.x === data.x && older.y === data.y) {
      canceledIds[older.id] = true;
      workerLog(data.log, 'duplicate canceled ' + data.z + '/' + data.x + '/' + data.y + ' (id ' + older.id + ')');
    }
  }
  processNextRequest();
};
