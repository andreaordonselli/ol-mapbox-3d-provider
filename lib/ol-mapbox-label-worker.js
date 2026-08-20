// Dedicated LABEL worker for ol-mapbox-providers.
//
// This worker produces ONE product: the globally-decluttered point-label set
// for a geographic view (getLabelsForView). It never produces tile bitmaps,
// so the expensive whole-view renders (which load every tile covering the
// camera and run one declutter pass over all of them) can never block the
// tile workers that feed the globe imagery. That is the whole point of the
// two-worker split: tile composition stays on its own fast pool, labels get
// their own runtime.
//
// Concurrency model: one ol.Map per worker, so one view renders at a time.
// The "latest view wins" rule is scoped PER CALLER (a caller is a globe):
// when a new view request arrives for the same caller, its previous
// in-flight/queued request is cancelled (a fast camera move must not pile up
// stale whole-view renders). Requests from DIFFERENT callers are queued in
// arrival order and never cancel each other, so three globes can share this
// worker safely.

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
// caller -> the latest view request queued/in-flight for that caller, so a
// new view for the same globe can cancel the stale one.
var pendingByCaller = {};
// Labels collected for the CURRENT view (reset per request).
var currentLabels = [];
var currentLabelKeys = {};
var labelWrappingDone = false;
var wrappedVectorLayers = [];
// Count of vector/raster tiles currently loading (OL's
// map.getLoadingOrNotReady() is unreliable right after renderSync).
var pendingTileLoads = 0;
var loadTrackingReady = false;
// Holds the current label's declutter priority while the wrapped style
// function runs, so describeLabel can read it without an extra argument.
var stylePriority = 0;
// Nominal zoom of the current view (stamped onto every label for bookkeeping).
var currentTileZoom = 0;

function workerLog(enabled, message) {
  if (enabled) {
    console.log('[ol-mapbox-label-worker] ' + message);
  }
}

function isCanceled(id) {
  if (canceledIds[id]) {
    delete canceledIds[id];
    return true;
  }
  return false;
}

// Returns the [lon, lat] ANCHOR of a feature geometry (point / line / polygon),
// the same anchor ol-mapbox-style would use for the label.
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

// Extracts the font size (px) from an ol/style/Text font string.
function fontPixelSize(font) {
  if (!font) {
    return null;
  }
  var match = /([\d.]+)px/.exec(font);
  return match ? parseFloat(match[1]) : null;
}

// Normalizes an ol/style color (string OR [r,g,b,a] array) to a CSS color the
// globes can feed straight into Cesium / SVG / CSS.
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
// draw a small anchor dot where the label is placed — the same visual hint
// ol-mapbox-style gives with its symbol icons. Returns null when the style has
// no icon (plain text labels like country/city names must NOT get a dot).
//   CircleStyle / RegularShape -> { color, size } from the fill + radius.
//   Icon (sprite / SDF)        -> { color, size } from the tint + width.
function describeIcon(imageStyle) {
  if (!imageStyle) {
    return null;
  }
  try {
    if (typeof imageStyle.getRadius === 'function') {
      var radius = imageStyle.getRadius();
      var fill = imageStyle.getFill ? imageStyle.getFill() : null;
      var fillColor = fill && fill.getColor ? fill.getColor() : null;
      return {
        color: colorToString(fillColor),
        size: radius ? Number(radius) : 4
      };
    }
    if (typeof imageStyle.getSrc === 'function') {
      var width = imageStyle.getWidth ? imageStyle.getWidth() : null;
      var tint = imageStyle.getColor ? imageStyle.getColor() : null;
      return {
        color: colorToString(tint),
        size: width ? Number(width) / 2 : 4
      };
    }
    return { color: null, size: 4 };
  } catch (e) {
    return null;
  }
}

// Returns a serializable plain object describing an ol/style/Text point label,
// preserving style + anchor so a globe can build its own billboard.
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
    font: font,
    color: fillColor ? colorToString(fillColor) : null,
    haloColor: strokeColor ? colorToString(strokeColor) : null,
    haloWidth: strokeWidth !== null && strokeWidth !== undefined ? Number(strokeWidth) : null,
    size: fontPx !== null && fontPx !== undefined ? fontPx : null,
    scale: scale !== null && scale !== undefined ? Number(scale) : 1,
    offsetX: text.getOffsetX ? text.getOffsetX() : 0,
    offsetY: text.getOffsetY ? text.getOffsetY() : 0,
    textAlign: text.getTextAlign ? text.getTextAlign() : null,
    textBaseline: text.getTextBaseline ? text.getTextBaseline() : null,
    placement: text.getPlacement ? text.getPlacement() : 'point',
    rotation: text.getRotation ? text.getRotation() : 0,
    rotateWithView: text.getRotateWithView ? text.getRotateWithView() : false,
    // View mode collects POINT labels only; line labels stay baked in the
    // tile bitmaps, so there is no line direction here.
    lineAngle: null,
    // Declutter priority (higher = drawn first), from the style z-index.
    priority: stylePriority || 0,
    // Anchor dot / icon marker (null = plain text label, no dot).
    icon: icon,
    zoom: currentTileZoom,
    properties: properties
  };
}

// Wraps one vector layer's style function so that, during the same render pass
// that loads the view's tiles:
//   - POINT labels are collected (with their icon) and REMOVED from the style
//     so they are not painted into the (discarded) view canvas;
//   - LINE labels and icon siblings are stripped too (no wasted text/icon
//     painting on a canvas we throw away).
// Only point labels become billboards; line labels live in the tile bitmaps.
function wrapStyleFunctionForLabels(styleFunction) {
  return function (feature, resolution) {
    var styles = styleFunction(feature, resolution);
    if (!styles) {
      return styles;
    }
    var list = Array.isArray(styles) ? styles : [styles];
    var properties = feature.getProperties ? feature.getProperties() : {};
    var layerName = properties['mvt:layer'] || properties.layer || '';

    // Find the feature's icon (on the text style itself or a sibling image
    // style) and whether it has a point text label.
    var icon = null;
    var hasPointLabel = false;
    for (var i = 0; i < list.length; i += 1) {
      var candidate = list[i];
      if (!candidate) {
        continue;
      }
      var im = candidate.getImage && candidate.getImage();
      if (im && !icon) {
        icon = describeIcon(im);
      }
      var candidateText = candidate.getText && candidate.getText();
      if (candidateText && candidateText.getText && candidateText.getText()) {
        var placement = candidateText.getPlacement ? candidateText.getPlacement() : 'point';
        if (placement !== 'line') {
          hasPointLabel = true;
        }
      }
    }

    var withoutText = [];
    for (var j = 0; j < list.length; j += 1) {
      var style = list[j];
      if (!style) {
        continue;
      }
      var text = style.getText && style.getText();
      var label = text && text.getText && text.getText();
      var image = style.getImage && style.getImage();
      if (label) {
        var placement = text.getPlacement ? text.getPlacement() : 'point';
        if (placement !== 'line') {
          // Point label -> collect as a billboard. Dedupe on layer + text +
          // coordinate (the style function runs on several render passes).
          var coord = featureLonLat(feature);
          var key = layerName + '|' + label + '|' + (coord ? coord[0] + ',' + coord[1] : 'null');
          if (!currentLabelKeys[key]) {
            currentLabelKeys[key] = true;
            stylePriority = (typeof style.getZIndex === 'function' &&
              style.getZIndex() !== null && style.getZIndex() !== undefined)
              ? style.getZIndex() : 0;
            currentLabels.push(describeLabel(feature, text, layerName, icon));
          }
        }
        // Point and line labels alike are stripped: the view canvas is
        // discarded, so painting text/icon glyphs into it is pure waste.
        continue;
      }
      if (image && hasPointLabel) {
        // Icon sibling of a stripped point label: the globe draws the dot, so
        // don't paint the icon into the discarded canvas either.
        continue;
      }
      withoutText.push(style);
    }
    return Array.isArray(styles) ? withoutText : (withoutText[0] || undefined);
  };
}

// Wraps every vector layer's style function once (after olms.apply).
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
}

// OpenLayers caches each vector layer's rendered canvas by its revision number;
// bump changed() so the wrapped style function re-runs on the next render.
function invalidateVectorLayers() {
  for (var i = 0; i < wrappedVectorLayers.length; i += 1) {
    if (typeof wrappedVectorLayers[i].changed === 'function') {
      wrappedVectorLayers[i].changed();
    }
  }
}

// Counts in-flight source tile loads so waitForResources can wait for the real
// tile readiness instead of map.getLoadingOrNotReady().
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

// Releases the worker's OpenLayers source tile caches after a view render. Each
// view is a different extent/zoom (views are debounced + keyed), so the old
// tiles would not be reused anyway; clearing them bounds worker memory across
// many zooms, which matters on phones with 3D terrain where every MB counts.
function clearSources() {
  if (!map) {
    return;
  }
  map.getLayers().forEach(function (layer) {
    var source = layer.getSource && layer.getSource();
    if (source && typeof source.clear === 'function') {
      source.clear();
    }
  });
}

// Applies ol-mapbox-style's declutter over the WHOLE view (spatial-hash greedy
// pass). Boxes are computed in tile pixel space; higher text-priority wins.
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
      setTimeout(function () {
        // Drop the labels collected while the right-zoom tiles were still
        // loading (OpenLayers fell back to lower-zoom tiles covering whole
        // countries). Only the labels of this final, fully-loaded frame are
        // the ones the 2D map would draw. Invalidate so renderSync re-runs the
        // wrapped style functions and re-collects the final frame's labels.
        function finalRender() {
          currentLabels.length = 0;
          currentLabelKeys = {};
          invalidateVectorLayers();
          map.renderSync();
        }
        finalRender();
        // The FIRST whole-view render of a fresh worker can still be empty even
        // when the tiles are ready: the style's glyph/font atlas loads a beat
        // later and text styles cannot be measured until then, so this pass
        // collects zero point labels. If the pass came up empty, re-render once
        // after the atlas has had a chance to arrive — the 2D map would draw
        // these labels on its next frame. Genuinely empty views (open ocean)
        // just pay one extra render pass.
        if (currentLabels.length === 0) {
          setTimeout(function () {
            finalRender();
            setTimeout(resolve, 15);
          }, 300);
        } else {
          setTimeout(resolve, 15);
        }
      }, 15);
    };
    var check = function () {
      attempts += 1;
      if (attempts === 1 || attempts % 4 === 0) {
        map.renderSync();
      }
      var loading = map.getLoadingOrNotReady() || pendingTileLoads > 0;
      if (!loading && attempts >= 3) {
        finish();
        return;
      }
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
      throw new Error('OffscreenCanvas is not available in this worker; this device cannot render labels.');
    }
    canvas = new OffscreenCanvas(data.resolution || 256, data.resolution || 256);
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
    return olms.apply(map, data.style).then(function () {
      attachLoadTracking();
      wrapLayersForLabels();
    }, function (error) {
      throw error;
    });
  }
  return Promise.resolve();
}

// Renders the WHOLE view and returns the final, globally-decluttered point
// label set — exactly the set the 2D OpenLayers map draws for that viewport.
function processViewRequest(data) {
  var id = data.id;
  var caller = data.caller || 'provider';
  activeRequestId = id;
  currentLabels.length = 0;
  currentLabelKeys = {};
  var extent = data.extent; // Web-Mercator [minX, minY, maxX, maxY]
  var widthPx = data.resolution || 256;
  var extentW = extent[2] - extent[0];
  var extentH = extent[3] - extent[1];
  var heightPx = Math.max(1, Math.round(widthPx * (extentH / extentW)));
  currentTileZoom = Math.max(0, Math.round(Math.log2((worldExtent * 2) / (extentW / widthPx))));
  invalidateVectorLayers();
  workerLog(data.log, 'view render start (id ' + id + ', caller ' + caller + ') ' +
    widthPx + 'x' + heightPx + 'px');
  initialize(data).then(function () {
    if (isCanceled(id)) { throw new Error('CANCELED'); }
    canvas.width = widthPx;
    canvas.height = heightPx;
    map.setSize([widthPx, heightPx]);
    map.getView().setCenter([(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2]);
    map.getView().setResolution(extentW / widthPx);
    return waitForResources(data);
  }).then(function () {
    if (isCanceled(id)) { throw new Error('CANCELED'); }
    var labels = declutterLabels(currentLabels, extent, widthPx);
    // Keep only the labels whose anchor falls inside the requested extent
    // (OpenLayers may have touched features beyond it via tile buffers).
    var lonLat = ol.proj.transformExtent(extent, 'EPSG:3857', 'EPSG:4326');
    labels = (labels || []).filter(function (label) {
      var c = label.coordinate || [0, 0];
      return c[0] >= lonLat[0] && c[0] <= lonLat[2] &&
             c[1] >= lonLat[1] && c[1] <= lonLat[3];
    });
    self.postMessage({
      id: id,
      ok: true,
      labels: labels,
      extent: extent
    });
    workerLog(data.log, 'view render done (id ' + id + ') labels=' + labels.length);
  }).catch(function (error) {
    if (error.message === 'CANCELED') {
      workerLog(data.log, 'view render cancel (id ' + id + ')');
      return;
    }
    workerLog(data.log, 'view render error (id ' + id + '): ' + (error.message || String(error)));
    self.postMessage({
      id: id,
      ok: false,
      error: error.message || String(error)
    });
  }).then(function () {
    if (pendingByCaller[caller] === data) {
      delete pendingByCaller[caller];
    }
    processingRequest = false;
    activeRequestId = null;
    clearSources();
    processNextRequest();
  });
}

function processNextRequest() {
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
  processViewRequest(requestStack.pop());
}

self.onmessage = function (event) {
  var data = event.data;
  if (data.reset) {
    // A source-layer filter changed: drop collected labels and force the
    // wrapped layers to re-compose on the next request.
    currentLabels.length = 0;
    currentLabelKeys = {};
    invalidateVectorLayers();
    return;
  }
  if (data.cancel) {
    var ids = Array.isArray(data.cancel) ? data.cancel : [data.cancel];
    for (var i = 0; i < ids.length; i += 1) {
      canceledIds[ids[i]] = true;
    }
    if (!processingRequest) {
      processNextRequest();
    }
    return;
  }
  if (data.mode === 'view') {
    var caller = data.caller || 'provider';
    // Latest view wins per caller: cancel this globe's previous view render.
    var previous = pendingByCaller[caller];
    if (previous) {
      canceledIds[previous.id] = true;
    }
    pendingByCaller[caller] = data;
    requestStack.push(data);
    workerLog(data.log, 'queued view (id ' + data.id + ', caller ' + caller +
      ', stack ' + requestStack.length + ')');
    processNextRequest();
    return;
  }
};
