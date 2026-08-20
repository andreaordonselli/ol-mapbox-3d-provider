(function (root) {
  'use strict';

  /*
   * ol-mapbox-globes — OlMapbox3DGlobe (shared core)
   *
   * This file is the thin, engine-agnostic core: the public `OlMapbox3DGlobe`
   * dispatcher plus the small helpers every engine adapter shares. The
   * engine-specific code lives in one file per globe library, so each library
   * maintainer can review exactly the work done for their globe:
   *
   *   lib/ol-mapbox-additional-code-giro3d.js      -> Giro3D
   *   lib/ol-mapbox-additional-code-cesium.js      -> Cesium
   *   lib/ol-mapbox-additional-code-openglobus.js  -> OpenGlobus
   *
   * Each adapter registers itself at load time:
   *
   *   OlMapbox3DGlobe.register('giro3d', {
   *     create: createGiro3d,
   *     activateTerrain: activateGiro3dTerrain,
   *     deactivateTerrain: deactivateGiro3dTerrain
   *   });
   *
   * Applications use one uniform entry point:
   *
   *   OlMapbox3DGlobe.create(engine, options) -> Promise<state>
   *   OlMapbox3DGlobe.activateTerrain(engine, state, options)
   *   OlMapbox3DGlobe.deactivateTerrain(engine, state, options)
   *
   * `options` is the same for every engine:
   *
   *   {
   *     target:        'giro3d-globe',        // element id (or element)
   *     provider:      OlMapbox3DProvider,    // shared style provider
   *     deviceProfile: profile,               // optional: auto-derived from
   *                                           // OlMapbox3DProvider.getDeviceProfile()
   *     tileFilter:    function () -> array,  // "tiles" combo -> source-layers|null
   *     labelFilter:   function () -> array,  // "labels" combo -> source-layers|null
   *     initialView:   [lon, lat],            // WGS84 starting position
   *     cesiumMap:     ol.Map,                // Cesium only (for ol-cesium sync)
   *     terrain:       false                  // OpenGlobus only (build with terrain)
   *   }
   *
   * `state` is also uniform:
   *
   *   {
   *     labelLayer,          // engine billboards bound to the provider
   *     refreshLabels(),     // re-fetch the view's label set now
   *     setTileFilter(a),    // re-compose tile bitmaps with a source-layer filter
   *     addTerrain(),        // (via activateTerrain) drape the imagery on a DTM
   *     removeTerrain(),     // (via deactivateTerrain) restore the flat globe
   *   }
   *
   * Tiles and labels come from the SAME OlMapbox3DProvider / worker pipeline:
   * the worker renders each style once (tile bitmaps) and returns the already
   * decluttered, priority-ordered label set for the whole camera view. The
   * engines never see OpenLayers; they only upload ImageBitmaps and draw
   * billboards. Terrain (when activated) is a plain draping layer and the
   * "shadows" are the engines' sun-based hillshade, not geometry.
   */

  function getWebGLSupport() {
    try {
      const canvas = document.createElement('canvas');
      const gl2 = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false });
      if (gl2) {
        return 'webgl2';
      }
      const gl1 = canvas.getContext('webgl', { failIfMajorPerformanceCaveat: false }) ||
        canvas.getContext('experimental-webgl');
      return gl1 ? 'webgl' : null;
    } catch (error) {
      return null;
    }
  }

  function resolveTarget(target) {
    return typeof target === 'string' ? document.getElementById(target) : target;
  }

  // A small filled circle (SVG data URI) used as the anchor-dot "icon" for
  // point labels that carry a symbol icon in the style — the same hint
  // ol-mapbox-style gives with its symbol icons.
  function dotSvgDataUri(color, diameter) {
    const radius = Math.max(2, Math.round(diameter / 2));
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + (radius * 2) +
      '" height="' + (radius * 2) + '"><circle cx="' + radius + '" cy="' + radius +
      '" r="' + radius + '" fill="' + color + '"/></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  // Resolves a label's icon info (collected by the worker from the style's
  // symbol image) into a concrete dot color + diameter. Returns null for plain
  // text labels (country/city names) — no dot, exactly like the 2D map.
  function labelDot(label) {
    if (!label || !label.icon) {
      return null;
    }
    const size = label.icon.size || 4;
    const scale = label.scale || 1;
    const diameter = Math.round(Math.max(3, Math.min(14, size * 2 * scale)));
    return {
      color: label.icon.color || '#6b7280',
      diameter: diameter
    };
  }

  // Caps the whole-view label render width: smaller on constrained devices so
  // the label worker composes a cheaper view (fewer pixels, fewer source tiles).
  function labelViewResolution(deviceProfile, canvasWidth) {
    const cap = deviceProfile && deviceProfile.constrained ? 640 : 1280;
    return Math.max(320, Math.min(canvasWidth || 800, cap));
  }

  // Engine adapters, keyed by engine name. Filled by the per-engine files.
  const engines = {};

  root.OlMapbox3DGlobe = {
    // Reports the best WebGL context this device offers (webgl2 / webgl / null).
    getWebGLSupport: getWebGLSupport,

    // Shared helpers for the per-engine adapter files.
    helpers: {
      getWebGLSupport: getWebGLSupport,
      resolveTarget: resolveTarget,
      dotSvgDataUri: dotSvgDataUri,
      labelDot: labelDot,
      labelViewResolution: labelViewResolution
    },

    // Registers an engine adapter. Called at load time by each per-engine file.
    register: function (engine, impl) {
      engines[engine] = impl;
    },

    // One constructor for every engine. `options.deviceProfile` is optional:
    // when omitted it is derived automatically from the shared provider, so an
    // application never needs to call getDeviceProfile() itself.
    create: function (engine, options) {
      options = Object.assign({}, options || {});
      if (!options.deviceProfile && root.OlMapbox3DProvider &&
          typeof root.OlMapbox3DProvider.getDeviceProfile === 'function') {
        options.deviceProfile = root.OlMapbox3DProvider.getDeviceProfile();
      }
      const impl = engines[engine];
      if (!impl || typeof impl.create !== 'function') {
        return Promise.reject(new Error('Unknown globe engine: ' + engine +
          ' (load the matching lib/ol-mapbox-additional-code-' + engine + '.js)'));
      }
      return impl.create(options);
    },

    // Drapes the styled imagery on a terrain layer (and turns on sun lighting).
    // Returns the (possibly recreated) state — OpenGlobus rebuilds its globe.
    activateTerrain: function (engine, state, options) {
      const impl = engines[engine];
      if (!impl || typeof impl.activateTerrain !== 'function') {
        return Promise.reject(new Error('Unknown globe engine: ' + engine));
      }
      return impl.activateTerrain(state, options);
    },

    // Restores the flat globe (removes the elevation layer / terrain provider,
    // or recreates the OpenGlobus globe without terrain).
    deactivateTerrain: function (engine, state, options) {
      const impl = engines[engine];
      if (!impl || typeof impl.deactivateTerrain !== 'function') {
        return Promise.reject(new Error('Unknown globe engine: ' + engine));
      }
      return impl.deactivateTerrain(state, options);
    }
  };
})(typeof globalThis === 'undefined' ? window : globalThis);
