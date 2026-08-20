(function (root) {
  'use strict';

  /*
   * ol-mapbox-additional-code-cesium.js — Cesium adapter
   *
   * Standalone Cesium integration for the ol-mapbox-providers pipeline. Every
   * piece of Cesium-specific code lives in this one file: the custom imagery
   * provider, the native LabelCollection billboards and the terrain provider
   * handling. It depends only on the Cesium / ol-cesium globals and the shared
   * core below.
   *
   * Prerequisites (loaded before this file):
   *   1. Cesium                 (window.Cesium)
   *   2. ol-cesium              (window.olcs) — Cesium wraps an ol.Map
   *   3. ol-mapbox-globes.js    (window.OlMapbox3DGlobe)
   *
   * This file registers ONE adapter with the shared core at load time:
   *
   *   OlMapbox3DGlobe.register('cesium', {
   *     create: createCesium,
   *     activateTerrain: activateCesiumTerrain,
   *     deactivateTerrain: deactivateCesiumTerrain
   *   });
   *
   * ---- Contract -------------------------------------------------------------
   *
   * The three functions form the whole engine contract. `create` builds the
   * globe and returns a state object; the terrain functions accept that state
   * (plus the same options) and return the updated state. Applications always
   * call them through the shared core:
   *
   *   const options = {
   *     target: 'globe',            // element id (or element) to render into
   *     provider: provider,         // OlMapbox3DProvider (style + workers)
   *     deviceProfile: profile,     // optional; auto-derived when omitted
   *     tileFilter: () => [...],    // optional source-layer filter for tiles
   *     labelFilter: () => [...],   // optional source-layer filter for labels
   *     initialView: [lon, lat],    // WGS84 starting position
   *     cesiumMap: olMap            // Cesium-only: the ol.Map to wrap
   *   };
   *
   *   OlMapbox3DGlobe.create('cesium', options)
   *     .then(state => OlMapbox3DGlobe.activateTerrain('cesium', state, options))
   *     .then(state => OlMapbox3DGlobe.deactivateTerrain('cesium', state, options));
   *
   * The returned state exposes:
   *   - labelLayer     : billboards bound to the provider's label set
   *   - refreshLabels(): re-fetch the visible label set immediately
   *   - setTileFilter(): re-compose the tile imagery with a new layer filter
   *
   * Shared helpers (target resolution, label dots, view resolution caps,
   * WebGL detection) come from OlMapbox3DGlobe.helpers.
   */

  const H = root.OlMapbox3DGlobe.helpers;

  function createCesiumImageryProvider(provider, labelLayer, tileFilter) {
    const tilingScheme = new Cesium.WebMercatorTilingScheme();

    return {
      tileWidth: provider.resolution,
      tileHeight: provider.resolution,
      maximumLevel: 20,
      minimumLevel: 0,
      tilingScheme: tilingScheme,
      rectangle: tilingScheme.rectangle,
      ready: true,
      readyPromise: Promise.resolve(true),
      hasAlphaChannel: true,
      getTileCredits: function () {
        return undefined;
      },
      pickFeatures: function () {
        return undefined;
      },
      requestImage: function (x, y, level) {
        // Labels are NOT driven by the imagery requests: this globe renders the
        // whole view's label set via setView() (getLabelsForView), fetched only
        // when the camera moves. The imagery requests only produce the tile
        // bitmaps, filtered by the "tiles" combo (null = all source-layers).
        // The worker bitmap is drawn onto a canvas before Cesium uploads it:
        // Cesium applies UNPACK_FLIP_Y_WEBGL and a raw ImageBitmap is flipped
        // differently from a canvas across browsers (it put the imagery
        // upside-down). A canvas is the stable contract for requestImage.
        return provider.getTileImage(level, x, y, {
          caller: 'cesium',
          layers: typeof tileFilter === 'function' ? tileFilter() : null
        }).then(function (tile) {
          const canvas = document.createElement('canvas');
          canvas.width = tile.image.width;
          canvas.height = tile.image.height;
          canvas.getContext('2d').drawImage(tile.image, 0, 0);
          if (typeof tile.image.close === 'function') {
            tile.image.close();
          }
          return canvas;
        });
      }
    };
  }

  async function createCesium(options) {
    if (!H.getWebGLSupport()) {
      throw new Error('WebGL is not available on this device.');
    }
    const deviceProfile = options.deviceProfile;
    const cesiumContainer = H.resolveTarget(options.target);
    cesiumContainer.replaceChildren();
    const provider = options.provider;
    const olCesium = new olcs.OLCesium({
      map: options.cesiumMap,
      target: cesiumContainer,
      stopOpenLayersEventsPropagation: true,
      createSynchronizers: function () {
        return [];
      }
    });
    olCesium.setEnabled(true);
    const scene = olCesium.getCesiumScene();
    // Cap the drawing resolution to the device profile.
    scene.pixelRatio = deviceProfile.pixelRatio;
    if (deviceProfile.constrained) {
      // Phones: keep far fewer imagery/terrain tiles in GPU memory. The
      // default tileCacheSize is 100 and the screen-space error 2; halving
      // the cache and doubling the SSE cuts the live tile count ~4x, which is
      // the difference between a smooth globe and a tab crash on low-RAM
      // devices. Slightly softer detail, invisible at phone zoom levels.
      scene.globe.tileCacheSize = 48;
      scene.globe.maximumScreenSpaceError = 4;
    }
    // If the GPU context is lost, ask the browser to try to restore it.
    scene.canvas.addEventListener('webglcontextlost', function (event) {
      event.preventDefault();
      console.warn('[cesium] WebGL context lost — the browser will try to restore it.');
    }, false);

    // ---- Label billboards (getLabelsForView) -------------------------------
    // Cesium renders labels natively with a LabelCollection. The declutter is
    // done in the WORKER over the WHOLE view: the returned labels are already
    // non-overlapping and priority-ordered, so there is no per-frame declutter.
    const labelCollection = scene.primitives.add(new Cesium.LabelCollection());
    // Point primitives for the anchor dots of icon labels.
    const pointCollection = scene.primitives.add(new Cesium.PointPrimitiveCollection());
    // labelHandle -> { lon, lat } so postRender can re-test occlusion each frame.
    const labelAnchors = new Map();
    // Reusable scratch objects for the per-label math below.
    const labelPos = new Cesium.Cartesian3();
    const normalVec = new Cesium.Cartesian3();
    const toCameraVec = new Cesium.Cartesian3();

    const labelLayer = provider.createLabelLayer({
      caller: 'cesium',
      layers: typeof options.labelFilter === 'function' ? options.labelFilter() : null,
      maxLabels: deviceProfile.constrained ? 500 : 1500,
      addLabel: function (label) {
        const lon = label.coordinate[0];
        const lat = label.coordinate[1];
        // NOTE: in this Cesium build fromDegrees is
        // (lon, lat, height, ellipsoid, result) — pass undefined as ellipsoid.
        Cesium.Cartesian3.fromDegrees(lon, lat, 0, undefined, labelPos);
        const handle = labelCollection.add({
          position: labelPos.clone(),
          text: label.text,
          font: label.font || '12px sans-serif',
          fillColor: Cesium.Color.fromCssColorString(label.color || '#111111'),
          outlineColor: Cesium.Color.fromCssColorString(label.haloColor || '#ffffff'),
          outlineWidth: label.haloWidth || 0,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          horizontalOrigin: label.textAlign === 'left' ? Cesium.HorizontalOrigin.LEFT :
            label.textAlign === 'right' ? Cesium.HorizontalOrigin.RIGHT : Cesium.HorizontalOrigin.CENTER,
          verticalOrigin: label.textBaseline === 'top' ? Cesium.VerticalOrigin.TOP :
            label.textBaseline === 'bottom' ? Cesium.VerticalOrigin.BOTTOM : Cesium.VerticalOrigin.CENTER,
          pixelOffset: new Cesium.Cartesian2(label.offsetX || 0, -(label.offsetY || 0)),
          scale: label.scale || 1,
          // Always render on top of the terrain, like 2D map labels.
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        });
        // Anchor dot for labels that carry a symbol icon in the style.
        let pointHandle = null;
        const dot = H.labelDot(label);
        if (dot) {
          pointHandle = pointCollection.add({
            position: labelPos.clone(),
            color: Cesium.Color.fromCssColorString(dot.color),
            pixelSize: dot.diameter,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          });
        }
        labelAnchors.set(handle, { lon: lon, lat: lat, point: pointHandle });
        return handle;
      },
      removeLabel: function (handle) {
        const meta = labelAnchors.get(handle);
        if (meta && meta.point) {
          pointCollection.remove(meta.point);
        }
        labelCollection.remove(handle);
        labelAnchors.delete(handle);
      }
    });

    // Returns the geographic extent currently on screen and the equivalent 2D
    // zoom level, derived from the Cesium camera.
    function currentViewExtent() {
      let extent = null;
      try {
        const rect = scene.camera.computeViewRectangle();
        if (rect) {
          extent = [
            Cesium.Math.toDegrees(rect.west),
            Cesium.Math.toDegrees(rect.south),
            Cesium.Math.toDegrees(rect.east),
            Cesium.Math.toDegrees(rect.north)
          ];
        }
      } catch (e) {
        extent = null;
      }
      return extent;
    }

    function currentViewZoom() {
      try {
        const cameraCart = scene.camera.positionCartographic;
        const height = cameraCart.height;
        if (height > 0) {
          const fovy = scene.camera.frustum.fovy;
          const mpp = 2 * height * Math.tan(fovy / 2) / scene.canvas.height;
          const cosLat = Math.cos(cameraCart.latitude);
          return Math.log2(156543.03392 * cosLat / mpp);
        }
      } catch (e) {
        // A frame can still be rendering while the camera is invalid.
      }
      return 0;
    }

    // Debounced view update: re-fetch the label set only when the camera has
    // moved enough. This is what makes the labels flicker-free.
    let lastLabelViewKey = '';
    let viewUpdateTimer = null;
    function scheduleLabelViewUpdate() {
      const extent = currentViewExtent();
      const zoom = currentViewZoom();
      const resolution = H.labelViewResolution(deviceProfile, scene.canvas.clientWidth || scene.canvas.width);
      if (!extent) {
        return;
      }
      const key = extent[0].toFixed(2) + ',' + extent[1].toFixed(2) + ',' +
        extent[2].toFixed(2) + ',' + extent[3].toFixed(2) + '|' +
        zoom.toFixed(1) + '|' + resolution;
      if (key === lastLabelViewKey) {
        return;
      }
      lastLabelViewKey = key;
      if (viewUpdateTimer) {
        clearTimeout(viewUpdateTimer);
      }
      viewUpdateTimer = setTimeout(function () {
        labelLayer.setView({ extent: extent, zoom: zoom, resolution: resolution });
      }, deviceProfile.constrained ? 400 : 150);
    }

    // Per-frame: HIDE the labels whose anchor is not in the current view
    // (behind the globe / outside the canvas). No declutter here.
    function syncCesiumLabels() {
      const cameraPosition = scene.camera.positionWC;
      const canvasWidth = scene.canvas.width;
      const canvasHeight = scene.canvas.height;
      labelAnchors.forEach(function (meta, handle) {
        Cesium.Cartesian3.fromDegrees(meta.lon, meta.lat, 0, undefined, labelPos);
        Cesium.Cartesian3.normalize(labelPos, normalVec);
        Cesium.Cartesian3.subtract(cameraPosition, labelPos, toCameraVec);
        let visible = Cesium.Cartesian3.dot(normalVec, toCameraVec) > 0;
        if (visible) {
          const windowPos = Cesium.SceneTransforms.wgs84ToWindowCoordinates(scene, labelPos);
          visible = !!windowPos &&
            windowPos.x >= 0 && windowPos.x <= canvasWidth &&
            windowPos.y >= 0 && windowPos.y <= canvasHeight;
        }
        handle.show = visible;
        if (meta.point) {
          meta.point.show = visible;
        }
      });
      scheduleLabelViewUpdate();
    }
    scene.postRender.addEventListener(syncCesiumLabels);

    const imageryProvider = createCesiumImageryProvider(provider, labelLayer, options.tileFilter);
    let imageryLayer = scene.imageryLayers.addImageryProvider(imageryProvider);
    // Initial label fetch for the starting camera.
    scheduleLabelViewUpdate();
    return {
      olCesium: olCesium,
      provider: provider,
      imageryLayer: imageryLayer,
      labelLayer: labelLayer,
      scene: scene,
      terrainProvider: null,
      // Re-fetches the label set for the current camera immediately.
      refreshLabels: function () {
        const extent = currentViewExtent();
        const zoom = currentViewZoom();
        if (!extent) {
          return;
        }
        labelLayer.setView({
          extent: extent,
          zoom: zoom,
          resolution: H.labelViewResolution(deviceProfile, scene.canvas.clientWidth || scene.canvas.width)
        });
      },
      // Re-applies the TILE source-layer filter: the imagery layer is re-created.
      setTileFilter: function (layers) {
        scene.imageryLayers.remove(imageryLayer, true);
        const newProvider = createCesiumImageryProvider(provider, labelLayer, function () {
          return layers;
        });
        const newLayer = scene.imageryLayers.addImageryProvider(newProvider);
        imageryLayer = newLayer;
      }
    };
  }

  // Adds the Re:Earth quantized-mesh terrain to an already-running Cesium
  // globe. Swapping scene.terrainProvider at runtime is fully supported: the
  // styled imagery is draped over the new terrain automatically.
  async function activateCesiumTerrain(state) {
    if (!state || state.terrainProvider) {
      return state;
    }
    const scene = state.scene;
    console.log('[cesium terrain] requesting Re:Earth quantized-mesh tiles...');
    const terrainProvider = await Cesium.CesiumTerrainProvider.fromUrl(
      'https://terrain.reearth.land/cesium-mesh/ellipsoid',
      { requestVertexNormals: true, requestWaterMask: true }
    );
    scene.terrainProvider = terrainProvider;
    // Sun-based lighting: Cesium shades every terrain vertex with the sun
    // direction, so the relief casts shadows.
    scene.globe.enableLighting = true;
    state.terrainProvider = terrainProvider;
    console.log('[cesium terrain] ready: quantized-mesh tiles now load.');
    return state;
  }

  // Swaps the terrain provider back to the plain ellipsoid and disables the
  // sun lighting, restoring the flat globe.
  async function deactivateCesiumTerrain(state) {
    if (!state || !state.terrainProvider) {
      return state;
    }
    const scene = state.scene;
    console.log('[cesium terrain] restoring the ellipsoid terrain...');
    scene.terrainProvider = new Cesium.EllipsoidTerrainProvider();
    scene.globe.enableLighting = false;
    state.terrainProvider = null;
    return state;
  }

  root.OlMapbox3DGlobe.register('cesium', {
    create: createCesium,
    activateTerrain: activateCesiumTerrain,
    deactivateTerrain: deactivateCesiumTerrain
  });
})(typeof globalThis === 'undefined' ? window : globalThis);
