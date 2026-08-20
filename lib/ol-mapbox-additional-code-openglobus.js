(function (root) {
  'use strict';

  /*
   * ol-mapbox-additional-code-openglobus.js — OpenGlobus adapter
   *
   * Standalone OpenGlobus integration for the ol-mapbox-providers pipeline.
   * Every piece of OpenGlobus-specific code lives in this one file: the custom
   * XYZ imagery source, the MSDF label layer (depth bias + terrain draping)
   * and the terrain activation path. OpenGlobus itself is loaded lazily below
   * via a dynamic import, so no other OpenGlobus script tag is required.
   *
   * Prerequisites (loaded before this file):
   *   1. ol-mapbox-globes.js (window.OlMapbox3DGlobe)
   *   2. OpenGlobus is fetched at runtime from './openglobus/og.es.js'
   *
   * This file registers ONE adapter with the shared core at load time:
   *
   *   OlMapbox3DGlobe.register('openglobus', {
   *     create: createOpenGlobus,
   *     activateTerrain: activateOpenGlobusTerrain,
   *     deactivateTerrain: deactivateOpenGlobusTerrain
   *   });
   *
   * ---- Contract -------------------------------------------------------------
   *
   * The three functions form the whole engine contract. `create` builds the
   * globe and returns a state object; the terrain functions accept that state
   * (plus the same options) and return the updated state. OpenGlobus starts
   * terrain reliably only from the Globe constructor, so the terrain functions
   * destroy and rebuild the globe with the `terrain` flag flipped. Applications
   * always call them through the shared core:
   *
   *   const options = {
   *     target: 'globe',            // element id (or element) to render into
   *     provider: provider,         // OlMapbox3DProvider (style + workers)
   *     deviceProfile: profile,     // optional; auto-derived when omitted
   *     tileFilter: () => [...],    // optional source-layer filter for tiles
   *     labelFilter: () => [...],   // optional source-layer filter for labels
   *     initialView: [lon, lat],    // WGS84 starting position
   *     terrain: false              // OpenGlobus-only: build with terrain
   *   };
   *
   *   OlMapbox3DGlobe.create('openglobus', options)
   *     .then(state => OlMapbox3DGlobe.activateTerrain('openglobus', state, options))
   *     .then(state => OlMapbox3DGlobe.deactivateTerrain('openglobus', state, options));
   *
   * The returned state exposes:
   *   - labelLayer     : billboards bound to the provider's label set
   *   - refreshLabels(): re-fetch the visible label set immediately
   *   - setTileFilter(): re-compose the tile imagery with a new layer filter
   *
   * Shared helpers (target resolution, label dots, view resolution caps,
   * WebGL detection) come from OlMapbox3DGlobe.helpers. The label depth bias
   * and terrain draping below are OpenGlobus-only and live here.
   */

  const H = root.OlMapbox3DGlobe.helpers;

  async function createOpenGlobus(options) {
    if (!H.getWebGLSupport()) {
      throw new Error('WebGL is not available on this device.');
    }
    const deviceProfile = options.deviceProfile;
    const openGlobusContainer = H.resolveTarget(options.target);
    openGlobusContainer.replaceChildren();
    const module = await import('./openglobus/og.es.js');
    const provider = options.provider;
    // In-flight tile requests keyed by material. When the camera moves fast,
    // OpenGlobus requests tiles for zoom levels it immediately abandons;
    // aborting them (signal) frees the shared workers for the tiles that are
    // actually on screen.
    const openGlobusInflight = new Map();
    const ProviderXYZ = class extends module.XYZ {
      constructor(name, opts) {
        super(name, opts);
        this.tileProvider = opts.tileProvider;
      }

      loadMaterial(material, force) {
        const segment = material.segment;
        material.texture = this._isBaseLayer
          ? segment.getDefaultTexture()
          : segment.planet.transparentTexture;
        material.isReady = false;
        material.isLoading = true;
        material.loadingAttempts += 1;
        const requestToken = (material.providerRequestToken || 0) + 1;
        material.providerRequestToken = requestToken;
        if (!this._checkSegment(segment)) {
          material.textureNotExists();
          return;
        }
        const z = segment.tileZoom;
        const x = segment.tileX;
        const y = segment.tileY;
        // A new request supersedes any in-flight one for this material (e.g.
        // the tile filter changed): abort it so the worker stops spending time
        // on the stale tile.
        const previous = openGlobusInflight.get(material);
        if (previous && typeof previous.abort === 'function') {
          previous.abort();
        }
        const abortController = new AbortController();
        const inflightEntry = {
          abort: function () { abortController.abort(); },
          material: material,
          segment: segment,
          start: Date.now()
        };
        openGlobusInflight.set(material, inflightEntry);
        // The "tiles" combo filters which source-layer is drawn in the tile
        // bitmap (null = all).
        this.tileProvider.getTileImage(z, x, y, {
          caller: 'openglobus',
          layers: typeof options.tileFilter === 'function' ? options.tileFilter() : null,
          signal: abortController.signal
        }).then(function (tile) {
          if (abortController.signal.aborted ||
              !material.isLoading || !segment.initialized ||
              material.providerRequestToken !== requestToken ||
              (!force && segment.node.getState() !== 1)) {
            tile.image.close();
            return;
          }
          try {
            material.applyImage(tile.image);
          } finally {
            tile.image.close();
          }
        }).catch(function (error) {
          if (!abortController.signal.aborted) {
            material.textureNotExists();
            console.error('OpenGlobus tile request failed.', { z, x, y, error });
          }
        }).finally(function () {
          if (openGlobusInflight.get(material) === inflightEntry) {
            openGlobusInflight.delete(material);
          }
        });
      }
    };
    const imagery = new ProviderXYZ('OpenFreeMap Liberty', {
      tileProvider: provider,
      isBaseLayer: true,
      minNativeZoom: 0,
      maxNativeZoom: 19
    });
    // dpi caps the drawing resolution to the device profile.
    const globeOptions = {
      target: openGlobusContainer,
      layers: [imagery],
      dpi: deviceProfile.pixelRatio,
      nightTextureSrc: null,
      specularTextureSrc: null,
      // OpenGlobus renders text labels with its own MSDF font atlas. These
      // atlas files live in lib/openglobus/fonts; without them no label text
      // ever renders.
      fontsSrc: './lib/openglobus/fonts',
      viewExtent: [6.75, 45.46, 7.94, 45.99]
    };
    // The terrain is added by activateTerrain. This bundle can only reliably
    // start terrain when given in the Globe CONSTRUCTOR (its terrainSwitch
    // path), so activateTerrain disposes the imagery-only globe and recreates
    // it with the terrain in the constructor.
    if (options.terrain) {
      // On constrained devices the terrain stops subdividing earlier.
      globeOptions.terrain = new module.GlobusRgbTerrain('reearth-terrain', {
        maxZoom: deviceProfile.constrained ? 14 : 17
      });
    }

    // The label text is hosted by an OpenGlobus Vector layer: a bare
    // EntityCollection does NOT set up the depth/polygon-offset handling this
    // build needs to draw the MSDF label text in front of the globe surface.
    const labelCollection = new module.Vector('openfreemap-labels', {
      visibility: true
    });
    globeOptions.layers.push(labelCollection);

    // OpenGlobus anchors label entities to the ellipsoid (height 0). Once the
    // GlobusRgbTerrain displaces the surface upward, the depth test buries the
    // MSDF label text under the relief. This bundle consumes each entity
    // collection's `polygonOffsetUnits` as the label shader's `depthOffset`
    // (clip-space z; negative = toward the camera), but the Vector layer does
    // NOT forward it to the per-node EntityCollections it creates for label
    // entities — they all stay at 0. So we apply the bias directly to every
    // collection in the quad-tree here (the same pattern the bundle itself
    // uses in `setPickingEnabled`). The default (-200) clears roughly one
    // kilometre of local relief at typical camera distances
    // (10-100 km up); it only changes the DEPTH of the label, never its
    // screen position, so labels simply stay readable on top of the terrain.
    // Tune without touching code: append ?labelDepthBias=400 (or 0 to disable)
    // to the page URL.
    let labelDepthBias = Number(options.labelDepthBias);
    if (!isFinite(labelDepthBias)) {
      labelDepthBias = -200;
    }
    console.log('[openglobus] label depth bias:', labelDepthBias, '(URL ?labelDepthBias= to tune, 0 disables)');
    function applyLabelDepthBias() {
      const strategy = labelCollection._entityCollectionsTreeStrategy;
      if (!strategy) {
        return;
      }
      const roots = [
        strategy._entityCollectionsTree,
        strategy._entityCollectionsTreeNorth,
        strategy._entityCollectionsTreeSouth,
        strategy._entityCollectionsTreeEast,
        strategy._entityCollectionsTreeWest
      ];
      const visited = new Set();
      function visit(node) {
        if (!node || visited.has(node)) {
          return;
        }
        visited.add(node);
        if (node.entityCollection) {
          node.entityCollection.polygonOffsetUnits = labelDepthBias;
        }
        const children = node.childNodes;
        if (children) {
          for (let i = 0; i < children.length; i++) {
            visit(children[i]);
          }
        }
      }
      for (let i = 0; i < roots.length; i++) {
        visit(roots[i]);
      }
    }

    const globe = new module.Globe(globeOptions);
    // The label Vector builds its entity-collection quad-tree when the Globe
    // adds the layers, so the (currently empty) tree exists from now on.
    applyLabelDepthBias();

    // ---- Drape labels on the 3D terrain -------------------------------------
    // OpenGlobus anchors label entities to the ellipsoid (height 0). With the
    // GlobusRgbTerrain active the surface rises by hundreds or thousands of
    // metres (the Aosta valley sits at ~600 m, the surrounding peaks at
    // 3000+), so the depth test buries the MSDF text under the relief — the
    // fixed `labelDepthBias` above only clears a bounded amount and falls
    // short in close-up valley views. Draping re-positions every label entity
    // at the terrain height below it (sampled at the CURRENT camera zoom, so
    // the query reuses the heightmap tiles the renderer already loaded), plus
    // a small clearance so the text never z-fights with the surface. Without
    // terrain the sampled height is 0 and behaviour is unchanged.
    // URL: ?labelDrape=0 disables (labels sink back under the terrain).
    const labelDrapeParam = new URLSearchParams(location.search).get('labelDrape');
    const labelDrapeEnabled = labelDrapeParam === null || labelDrapeParam !== '0';
    const labelDrapeLift = 50; // metres of clearance above the terrain surface
    console.log('[openglobus] label draping:', labelDrapeEnabled ? 'on' : 'off',
      '(+' + labelDrapeLift + ' m lift; URL ?labelDrape=0 disables)');
    // Entities already draped at a given camera zoom are skipped on the next
    // pass; a zoom change invalidates them so labels track finer relief.
    const drapedLabelZoom = new WeakMap();
    function drapeLabelEntity(entity, zoom) {
      if (!labelDrapeEnabled || !entity || typeof entity.setLonLat2 !== 'function') {
        return;
      }
      const planet = globe.planet;
      const terrain = planet && planet.terrain;
      if (!terrain || typeof terrain.getHeightAsync !== 'function') {
        return;
      }
      const lonLat = entity._lonLat || entity.getLonLat();
      if (!lonLat || !isFinite(lonLat.lon) || !isFinite(lonLat.lat)) {
        return;
      }
      const tileZoom = Math.max(2, Math.min(Math.round(zoom) || 2, terrain.maxZoom || 17));
      const ll = new module.LonLat(lonLat.lon, lonLat.lat, 0);
      terrain.getHeightAsync(ll, function (height) {
        let h = Number(height);
        if (!isFinite(h)) {
          h = 0;
        }
        const geoid = terrain.geoid;
        if (geoid && typeof geoid.getHeightLonLat === 'function') {
          const undulation = Number(geoid.getHeightLonLat(ll));
          if (isFinite(undulation)) {
            h += undulation;
          }
        }
        try {
          // Keep ALL of the entity's position representations consistent, so
          // any later re-insert (the Vector's _proceedEntity and the tree's
          // __setLonLat__ both back-derive _lonLat from a non-zero
          // _cartesian) never resets the draped height back to 0:
          //   1) _lonLat — the geographic anchor
          //   2) _cartesian — the world position (setLonLat2 only recomputes
          //      it when the entity already has a renderNode)
          //   3) the label/billboard features' own rendered position
          entity.setLonLat2(ll.lon, ll.lat, h + labelDrapeLift);
          const cart = new module.Vec3();
          globe.planet.ellipsoid.lonLatToCartesianRes(entity._lonLat, cart);
          entity._cartesian.set(cart.x, cart.y, cart.z);
          if (entity.label && typeof entity.label.setPosition3v === 'function') {
            entity.label.setPosition3v(cart);
          }
          if (entity.billboard && typeof entity.billboard.setPosition3v === 'function') {
            entity.billboard.setPosition3v(cart);
          }
        } catch (e) {
          // Entity was removed before the terrain query resolved.
        }
      }, tileZoom);
    }
    function drapeAllLabels() {
      const zoom = currentCameraZoom();
      if (!isFinite(zoom)) {
        return;
      }
      const strategy = labelCollection._entityCollectionsTreeStrategy;
      if (!strategy) {
        return;
      }
      const roots = [
        strategy._entityCollectionsTree,
        strategy._entityCollectionsTreeNorth,
        strategy._entityCollectionsTreeSouth,
        strategy._entityCollectionsTreeEast,
        strategy._entityCollectionsTreeWest
      ];
      const visited = new Set();
      function visit(node) {
        if (!node || visited.has(node)) {
          return;
        }
        visited.add(node);
        const collection = node.entityCollection;
        if (collection && collection._entities) {
          for (let i = 0; i < collection._entities.length; i++) {
            const entity = collection._entities[i];
            if (drapedLabelZoom.get(entity) !== zoom) {
              drapedLabelZoom.set(entity, zoom);
              drapeLabelEntity(entity, zoom);
            }
          }
        }
        const children = node.childNodes;
        if (children) {
          for (let i = 0; i < children.length; i++) {
            visit(children[i]);
          }
        }
      }
      for (let i = 0; i < roots.length; i++) {
        visit(roots[i]);
      }
    }

    // OpenGlobus's default sun light uses a very dark ambient (0.15); brighten
    // it so the styled tiles keep their colors at every zoom level.
    if (globe.sun && globe.sun.sunlight) {
      globe.sun.sunlight.setAmbient(0.85, 0.85, 0.9);
      globe.sun.sunlight.setDiffuse(1, 1, 1);
      globe.sun.sunlight.setSpecular(0.1, 0.1, 0.1);
    }

    // If the GPU context is lost, ask the browser to try to restore it.
    if (globe.planet.renderer.handler.canvas) {
      globe.planet.renderer.handler.canvas.addEventListener('webglcontextlost', function (event) {
        event.preventDefault();
        console.warn('[openglobus] WebGL context lost — the browser will try to restore it.');
      }, false);
    }

    // ---- Label billboards (getLabelsForView) -------------------------------
    // OpenGlobus renders labels as entities with a Label feature, hosted by
    // the `labelCollection` Vector layer. Labels are VIEW-BASED (same pipeline
    // as Cesium): the worker returns the label set it would draw for the view,
    // already decluttered in screen space.
    const labelLayer = provider.createLabelLayer({
      caller: 'openglobus',
      layers: typeof options.labelFilter === 'function' ? options.labelFilter() : null,
      maxLabels: deviceProfile.constrained ? 600 : 3000,
      addLabel: function (label) {
        const dot = H.labelDot(label);
        const entityOptions = {
          name: label.text || 'label',
          label: {
            text: label.text || '',
            size: label.size || 14,
            face: 'arial',
            color: label.color || '#111111',
            outline: (label.haloWidth || 0) > 0 ? label.haloWidth : 0,
            outlineColor: label.haloColor || '#ffffff',
            align: label.textAlign === 'left' ? 'left' :
              label.textAlign === 'right' ? 'right' : 'center'
          },
          lonlat: [label.coordinate[0], label.coordinate[1]]
        };
        if (dot) {
          // Anchor dot for labels that carry a symbol icon in the style.
          entityOptions.billboard = {
            src: H.dotSvgDataUri(dot.color, dot.diameter),
            size: [dot.diameter, dot.diameter]
          };
        }
        const entity = new module.Entity(entityOptions);
        labelCollection.add(entity);
        // Adding an entity may create a fresh per-node EntityCollection for
        // this label (the Vector does not inherit the depth bias), so re-apply
        // it after every insert.
        applyLabelDepthBias();
        // Drape the new label on the terrain surface (no-op without terrain).
        drapeLabelEntity(entity, currentCameraZoom());
        return { entity: entity };
      },
      removeLabel: function (handle) {
        if (handle.entity) {
          handle.entity.remove();
        }
      }
    });

    // The geographic extent the OpenGlobus camera is currently showing
    // (lon/lat [west, south, east, north]).
    function currentOpenGlobusView() {
      const planet = globe.planet;
      if (!planet) {
        return null;
      }
      let ext = null;
      if (typeof planet.getExtent === 'function') {
        try {
          ext = planet.getExtent();
        } catch (e) {
          ext = null;
        }
      }
      if (!ext && typeof planet.getViewExtent === 'function') {
        ext = planet.getViewExtent();
      }
      if (!ext) {
        return null;
      }
      const handler = planet.renderer && planet.renderer.handler;
      const canvas = handler && handler.canvas;
      const resolution = H.labelViewResolution(deviceProfile, (canvas && (canvas.clientWidth || canvas.width)) || 800);
      const zoom = currentCameraZoom();
      return {
        extent: [ext.southWest.lon, ext.southWest.lat, ext.northEast.lon, ext.northEast.lat],
        zoom: zoom,
        resolution: resolution
      };
    }

    // Camera-derived tile zoom (z of the currently rendered terrain), used to
    // sample the terrain at the detail the user actually sees.
    function currentCameraZoom() {
      const planet = globe.planet;
      if (!planet) {
        return 0;
      }
      const handler = planet.renderer && planet.renderer.handler;
      const canvas = handler && handler.canvas;
      const camera = planet.camera;
      if (!camera || typeof camera.getHeight !== 'function') {
        return 0;
      }
      const height = camera.getHeight();
      const viewH = (canvas && (canvas.clientHeight || canvas.height)) || 800;
      const fovy = (typeof camera.getViewAngle === 'function') ? camera.getViewAngle() : 47;
      const lat = (globeOptions.viewExtent[1] + globeOptions.viewExtent[3]) / 2;
      const mpp = viewH > 0 ? (2 * height * Math.tan(fovy * Math.PI / 360)) / viewH : 1;
      return mpp > 0 ? Math.log2((156543.03392 * Math.cos(lat * Math.PI / 180)) / mpp) : 0;
    }

    // Debounced, keyed view update: re-fetch the label set only when the
    // camera has moved enough. The label layer DIFFS the new set against the
    // current billboards, so unchanged labels keep their handle (no flicker).
    let lastOpenGlobusViewKey = '';
    let openGlobusViewTimer = null;
    function scheduleOpenGlobusLabelView() {
      // Abort in-flight tile requests whose segment is no longer being
      // rendered: while the camera moves fast, OpenGlobus requests tiles for
      // zoom levels it immediately abandons.
      openGlobusInflight.forEach(function (entry) {
        if (Date.now() - entry.start < 2000) {
          return;
        }
        const seg = entry.segment;
        if (!seg || !seg.initialized ||
            (seg.node && seg.node.getState && seg.node.getState() !== 1)) {
          entry.abort();
        }
      });
      const view = currentOpenGlobusView();
      if (!view) {
        return;
      }
      const key = view.extent[0].toFixed(2) + ',' + view.extent[1].toFixed(2) + ',' +
        view.extent[2].toFixed(2) + ',' + view.extent[3].toFixed(2) + '|' + view.resolution;
      if (key === lastOpenGlobusViewKey) {
        return;
      }
      lastOpenGlobusViewKey = key;
      if (openGlobusViewTimer) {
        clearTimeout(openGlobusViewTimer);
      }
      openGlobusViewTimer = setTimeout(function () {
        labelLayer.setView({
          extent: view.extent,
          zoom: view.zoom,
          resolution: view.resolution,
          layers: typeof options.labelFilter === 'function' ? options.labelFilter() : null
        });
        // The setView diff may add labels asynchronously (worker round-trip);
        // keep the depth bias on every collection in case one was created by a
        // label-sync path that skipped addLabel, and re-drape everything so
        // labels whose camera zoom changed track the finer terrain detail.
        applyLabelDepthBias();
        drapeAllLabels();
      }, deviceProfile.constrained ? 500 : 200);
    }

    if (globe.planet.camera && globe.planet.camera.events &&
        typeof globe.planet.camera.events.on === 'function') {
      globe.planet.camera.events.on('viewchange', scheduleOpenGlobusLabelView);
    }
    if (globe.planet.events && typeof globe.planet.events.on === 'function') {
      globe.planet.events.on('rendercompleted', scheduleOpenGlobusLabelView);
    }
    const labelSyncTimer = setInterval(scheduleOpenGlobusLabelView, 1500);
    globe.planet.labelSyncTimer = labelSyncTimer;
    scheduleOpenGlobusLabelView();
    // Once the initial terrain heightmap tiles have settled, re-drape so any
    // label whose first query hit unloaded tiles gets the refined height.
    setTimeout(drapeAllLabels, 4000);

    return {
      globe: globe,
      provider: provider,
      layer: imagery,
      labelLayer: labelLayer,
      labelCollection: labelCollection,
      terrain: options.terrain ? globe.planet.terrain : null,
      // Re-fetches the label set for the current camera immediately.
      refreshLabels: function () {
        const view = currentOpenGlobusView();
        if (!view) {
          return;
        }
        labelLayer.setView({
          extent: view.extent,
          zoom: view.zoom,
          resolution: view.resolution,
          layers: typeof options.labelFilter === 'function' ? options.labelFilter() : null
        });
        applyLabelDepthBias();
        drapeAllLabels();
      },
      // Re-applies the TILE source-layer filter: the imagery layer re-requests
      // every currently-visible tile so only the selected source-layer is drawn.
      setTileFilter: function (layers) {
        const qts = globe.planet.quadTreeStrategy;
        const nodes = qts && qts._renderedNodes;
        const layerId = imagery && imagery.__id;
        if (nodes) {
          for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            const segment = node && node.segment;
            if (!segment) {
              continue;
            }
            const material = (layerId !== undefined && segment.materials)
              ? (segment.materials[layerId] || segment.material)
              : segment.material;
            if (!material) {
              continue;
            }
            material.isReady = false;
            material.isLoading = false;
            try {
              imagery.loadMaterial(material, true);
            } catch (e) {
              // The node may be mid-update; OpenGlobus will re-request on the
              // next applyMaterial pass.
            }
          }
        }
      }
    };
  }

  // Recreates the OpenGlobus globe with GlobusRgbTerrain in the constructor
  // (the only reliable terrain path in this bundle).
  async function activateOpenGlobusTerrain(state, options) {
    if (!state || state.terrain) {
      return state;
    }
    console.log('[openglobus terrain] recreating the globe with GlobusRgbTerrain...');
    // Stop the previous globe's label sync timer before destroying it.
    if (state.globe && state.globe.planet && state.globe.planet.labelSyncTimer) {
      clearInterval(state.globe.planet.labelSyncTimer);
    }
    state.globe.destroy();
    const next = Object.assign({}, options, { terrain: true });
    const newState = await createOpenGlobus(next);
    console.log('[openglobus terrain] ready: GlobusEarthRgb tiles now load.');
    return newState;
  }

  // Recreates the OpenGlobus globe WITHOUT the terrain, restoring the flat
  // imagery-only globe (the mirror image of activateOpenGlobusTerrain).
  async function deactivateOpenGlobusTerrain(state, options) {
    if (!state || !state.terrain) {
      return state;
    }
    console.log('[openglobus terrain] recreating the globe without terrain...');
    if (state.globe && state.globe.planet && state.globe.planet.labelSyncTimer) {
      clearInterval(state.globe.planet.labelSyncTimer);
    }
    state.globe.destroy();
    const next = Object.assign({}, options, { terrain: false });
    const newState = await createOpenGlobus(next);
    console.log('[openglobus terrain] ready: flat imagery globe restored.');
    return newState;
  }

  root.OlMapbox3DGlobe.register('openglobus', {
    create: createOpenGlobus,
    activateTerrain: activateOpenGlobusTerrain,
    deactivateTerrain: deactivateOpenGlobusTerrain
  });
})(typeof globalThis === 'undefined' ? window : globalThis);
