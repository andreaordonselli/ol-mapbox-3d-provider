(function (root) {
  'use strict';

  /*
   * ol-mapbox-additional-code-giro3d.js — Giro3D adapter
   *
   * Standalone Giro3D integration for the ol-mapbox-providers pipeline. Every
   * piece of Giro3D-specific code lives in this one file: the camera/extent
   * math, the CSS2D label billboards and the terrain layer handling. It
   * depends only on the Giro3D global and the shared core below.
   *
   * Prerequisites (loaded before this file):
   *   1. Giro3D              (window.Giro3D)
   *   2. ol-mapbox-globes.js (window.OlMapbox3DGlobe)
   *
   * This file registers ONE adapter with the shared core at load time:
   *
   *   OlMapbox3DGlobe.register('giro3d', {
   *     create: createGiro3d,
   *     activateTerrain: activateGiro3dTerrain,
   *     deactivateTerrain: deactivateGiro3dTerrain
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
   *     initialView: [lon, lat]     // WGS84 starting position
   *   };
   *
   *   OlMapbox3DGlobe.create('giro3d', options)
   *     .then(state => OlMapbox3DGlobe.activateTerrain('giro3d', state, options))
   *     .then(state => OlMapbox3DGlobe.deactivateTerrain('giro3d', state, options));
   *
   * The returned state exposes:
   *   - labelLayer     : billboards bound to the provider's label set
   *   - refreshLabels(): re-fetch the visible label set immediately
   *   - setTileFilter(): re-compose the tile imagery with a new layer filter
   *
   * Shared helpers (target resolution, label dots, view resolution caps,
   * WebGL detection) come from OlMapbox3DGlobe.helpers; the ECEF / camera /
   * view-extent math below is Giro3D-only and lives here.
   */

  const H = root.OlMapbox3DGlobe.helpers;

  // ---------------------------------------------------------------------------
  // Geodesy helpers (ECEF math shared by the Giro3D camera/extent conversions)
  // ---------------------------------------------------------------------------

  // Convert a WGS84 position to Earth-Centered, Earth-Fixed coordinates.
  function toEcef(longitude, latitude, altitude) {
    const longitudeRadians = longitude * Math.PI / 180;
    const latitudeRadians = latitude * Math.PI / 180;
    const equatorialRadius = 6378137;
    const eccentricitySquared = 0.00669437999014;
    const primeVerticalRadius = equatorialRadius /
      Math.sqrt(1 - eccentricitySquared * Math.sin(latitudeRadians) ** 2);
    const target = new Giro3D.Vector3(
      primeVerticalRadius * Math.cos(latitudeRadians) * Math.cos(longitudeRadians),
      primeVerticalRadius * Math.cos(latitudeRadians) * Math.sin(longitudeRadians),
      primeVerticalRadius * (1 - eccentricitySquared) * Math.sin(latitudeRadians)
    );
    return {
      target: target,
      camera: target.clone().normalize().multiplyScalar(target.length() + altitude)
    };
  }

  // ECEF camera offset for a tilted view: the camera sits `distance` metres
  // from the target, offset horizontally along `fromAzimuth` (0 = north,
  // 90 = east, 180 = south, 270 = west) and pitched up `pitchDegrees` above
  // the local horizon. A low pitch (e.g. 10-20°) looks at the mountains from
  // the side, which makes the relief shadows clearly visible (a nadir top-down
  // view makes the hillshade too subtle to notice).
  function tiltedViewEcef(longitude, latitude, distance, fromAzimuth, pitchDegrees) {
    const lonRad = longitude * Math.PI / 180;
    const latRad = latitude * Math.PI / 180;
    const equatorialRadius = 6378137;
    const eccentricitySquared = 0.00669437999014;
    const primeVerticalRadius = equatorialRadius /
      Math.sqrt(1 - eccentricitySquared * Math.sin(latRad) ** 2);
    const target = new Giro3D.Vector3(
      primeVerticalRadius * Math.cos(latRad) * Math.cos(lonRad),
      primeVerticalRadius * Math.cos(latRad) * Math.sin(lonRad),
      primeVerticalRadius * (1 - eccentricitySquared) * Math.sin(latRad)
    );
    // Local East-North-Up frame at the target.
    const east = new Giro3D.Vector3(-Math.sin(lonRad), Math.cos(lonRad), 0);
    const north = new Giro3D.Vector3(
      -Math.sin(latRad) * Math.cos(lonRad),
      -Math.sin(latRad) * Math.sin(lonRad),
      Math.cos(latRad)
    );
    const up = target.clone().normalize();
    const azimuthRad = fromAzimuth * Math.PI / 180;
    const pitchRad = pitchDegrees * Math.PI / 180;
    const horizontal = north.clone().multiplyScalar(Math.cos(azimuthRad))
      .add(east.clone().multiplyScalar(Math.sin(azimuthRad))).normalize();
    const offset = horizontal.multiplyScalar(distance * Math.cos(pitchRad))
      .add(up.multiplyScalar(distance * Math.sin(pitchRad)));
    return {
      target: target,
      camera: target.clone().add(offset)
    };
  }

  // The 2D-equivalent zoom level of the Giro3D camera (same formula as the
  // Cesium globe's currentViewZoom): derived from the camera height above the
  // ellipsoid and the vertical field of view.
  function giro3dCameraZoom(instance) {
    try {
      const camera = instance.view.camera;
      const canvas = instance.domElement;
      const p = camera.position;
      // The camera is in ECEF, so its radial distance minus the EQUATORIAL
      // radius is wrong away from the equator. Convert ECEF to geodetic height.
      const a = 6378137;
      const e2 = 0.00669437999014;
      const r = Math.sqrt(p.x * p.x + p.y * p.y);
      let lat = Math.atan2(p.z, r * (1 - e2));
      let height = 0;
      for (let i = 0; i < 6; i += 1) {
        const sinLat = Math.sin(lat);
        const n = a / Math.sqrt(1 - e2 * sinLat * sinLat);
        height = r / Math.cos(lat) - n;
        lat = Math.atan2(p.z, r * (1 - e2 * n / (n + height)));
      }
      if (height <= 0) {
        return null;
      }
      const fov = camera.fov * Math.PI / 180;
      const viewH = canvas.clientHeight || canvas.height || 800;
      const mpp = viewH > 0 ? (2 * height * Math.tan(fov / 2)) / viewH : 1;
      return mpp > 0 ? Math.log2((156543.03392 * Math.cos(lat)) / mpp) : 0;
    } catch (error) {
      return null;
    }
  }

  // Intersects a ray with the WGS84 ellipsoid. Returns the distance t from the
  // ray origin to the surface (the near intersection), or null when the ray
  // misses the ellipsoid (e.g. it points at the sky).
  function giro3dRayEllipsoid(origin, direction) {
    const a = 6378137;
    const b = 6356752.3142451793;
    const a2 = a * a;
    const b2 = b * b;
    const ox = origin.x, oy = origin.y, oz = origin.z;
    const dx = direction.x, dy = direction.y, dz = direction.z;
    const A = (dx * dx + dy * dy) / a2 + (dz * dz) / b2;
    const B = 2 * ((ox * dx + oy * dy) / a2 + (oz * dz) / b2);
    const C = (ox * ox + oy * oy) / a2 + (oz * oz) / b2 - 1;
    const disc = B * B - 4 * A * C;
    if (disc < 0 || A === 0) {
      return null;
    }
    const sqrtDisc = Math.sqrt(disc);
    let t = (-B - sqrtDisc) / (2 * A);
    if (t < 0) {
      t = (-B + sqrtDisc) / (2 * A);
    }
    return t > 0 ? t : null;
  }

  function giro3dEcefToLonLat(v) {
    const lon = Math.atan2(v.y, v.x) * 180 / Math.PI;
    const p = Math.sqrt(v.x * v.x + v.y * v.y);
    const lat = Math.atan2(v.z, p * (1 - 0.00669437999014)) * 180 / Math.PI;
    return [lon, lat];
  }

  // The geographic extent currently visible to the Giro3D camera — the
  // equivalent of Cesium's scene.camera.computeViewRectangle(). The four canvas
  // corners (plus edge midpoints) are unprojected to rays and intersected with
  // the ellipsoid; the bounding box of the ground hits is the view extent.
  function giro3dViewExtent(camera, canvas) {
    const w = canvas.clientWidth || canvas.width || 800;
    const h = canvas.clientHeight || canvas.height || 600;
    const corners = [
      [0, 0], [w, 0], [w, h], [0, h],
      [w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]
    ];
    const hits = [];
    for (let i = 0; i < corners.length; i += 1) {
      const ndc = new Giro3D.Vector3(
        (corners[i][0] / w) * 2 - 1,
        -(corners[i][1] / h) * 2 + 1,
        0.5
      );
      ndc.unproject(camera);
      const direction = ndc.clone().sub(camera.position).normalize();
      const t = giro3dRayEllipsoid(camera.position, direction);
      if (t !== null) {
        hits.push(giro3dEcefToLonLat(camera.position.clone().add(direction.clone().multiplyScalar(t))));
      }
    }
    if (!hits.length) {
      return null;
    }
    let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
    hits.forEach(function (lonLat) {
      west = Math.min(west, lonLat[0]);
      east = Math.max(east, lonLat[0]);
      south = Math.min(south, lonLat[1]);
      north = Math.max(north, lonLat[1]);
    });

    // Return the REAL visible extent (clamped only to the world bounds). A
    // previous version clamped this to a fixed 3°x2° box, so a zoomed-out view
    // of Europe returned only the few labels near the camera target instead of
    // the whole continent's names. The worker derives the zoom from the extent
    // width, so a wide view must produce a wide extent.
    const westC = Math.max(west, -180);
    const eastC = Math.min(east, 180);
    const southC = Math.max(south, -85);
    const northC = Math.min(north, 85);
    if (eastC <= westC || northC <= southC) {
      return null;
    }
    return [westC, southC, eastC, northC];
  }

  // ---------------------------------------------------------------------------
  // Giro3D
  // ---------------------------------------------------------------------------

  async function createGiro3d(options) {
    if (!H.getWebGLSupport()) {
      throw new Error('WebGL is not available on this device.');
    }
    const deviceProfile = options.deviceProfile;
    const initialView = options.initialView || [7.3203, 45.7378];
    const targetId = options.target;
    const globeContainer = H.resolveTarget(targetId);
    globeContainer.replaceChildren();
    const instance = new Giro3D.Instance({
      target: targetId,
      crs: Giro3D.CoordinateSystem.epsg4978,
      backgroundColor: 0x0a3b59,
      // Antialias is a big GPU cost on constrained devices; the device profile
      // decides (disabled on high-DPI/low-RAM devices).
      renderer: { antialias: deviceProfile.antialias }
    });
    // Cap the drawing resolution to the device profile.
    instance.renderer.setPixelRatio(deviceProfile.pixelRatio);

    // Tilted near-horizontal view so the relief shadows are clearly visible.
    const view = tiltedViewEcef(initialView[0], initialView[1], 20000, 180, 15);
    instance.view.camera.position.copy(view.camera);
    instance.view.camera.lookAt(view.target);
    instance.view.camera.updateMatrixWorld(true);

    const globe = new Giro3D.Globe({
      horizonCulling: false,
      // Sun-based hillshade on the terrain: the slopes facing away from the sun
      // are shaded so the relief casts visible shadows.
      lighting: {
        enabled: true,
        mode: 0,
        elevationLayersOnly: true,
        hillshadeIntensity: 1.2,
        hillshadeAzimuth: 270,
        hillshadeZenith: 50
      }
    });
    const provider = options.provider;
    await instance.add(globe);

    // ---- Label billboards (getLabelsForView) -------------------------------
    // Giro3D renders labels as CSS2D DOM elements. Labels are VIEW-BASED: the
    // globe hands the provider the geographic extent the camera sees and the
    // worker runs ONE whole-view declutter — the returned set is already
    // non-overlapping and priority-ordered.
    const labelLayer = provider.createLabelLayer({
      caller: 'giro3d',
      layers: typeof options.labelFilter === 'function' ? options.labelFilter() : null,
      maxLabels: deviceProfile.constrained ? 500 : 1500,
      // Giro3D renders labels as CSS2D DOM elements whose screen position is
      // written only during a render pass. The render loop is on-demand and is
      // usually paused by the time the worker's async label set lands, so the
      // just-added billboards would otherwise keep an empty CSS transform (they
      // stack at the canvas origin instead of their geographic positions).
      // Force exactly one repaint once the diff has applied.
      onLabelsChanged: function () {
        instance.render();
      },
      addLabel: function (label) {
        // Giro3D does not export the bundled three.js Object3D class, so reach
        // it through the scene's prototype chain (THREE.Scene -> THREE.Object3D).
        const Object3D = Object.getPrototypeOf(Object.getPrototypeOf(instance.scene)).constructor;
        const object = new Object3D();
        const element = document.createElement('div');
        element.textContent = label.text;
        element.style.font = label.font || '12px sans-serif';
        element.style.color = label.color || '#111';
        element.style.whiteSpace = 'nowrap';
        element.style.pointerEvents = 'none';
        // Absolutely positioned (shrink-to-fit) so the CSS2D percentage
        // transform is relative to the label box, not the whole canvas.
        element.style.position = 'absolute';
        element.style.userSelect = 'none';
        element.setAttribute('draggable', 'false');
        if (label.haloWidth && label.haloColor) {
          // Crisp text halo (Mapbox text-halo), like the 2D map draws it.
          const haloWidth = Math.max(1, Math.round(Number(label.haloWidth) || 1));
          element.style.textShadow = [
            haloWidth + 'px 0 0 ' + label.haloColor,
            -haloWidth + 'px 0 0 ' + label.haloColor,
            '0 ' + haloWidth + 'px 0 ' + label.haloColor,
            '0 ' + -haloWidth + 'px 0 ' + label.haloColor
          ].join(',');
        }
        object.isCSS2DObject = true;
        object.element = element;
        // Anchor: same alignment ol-mapbox-style produced (text-anchor).
        object.center = {
          x: label.textAlign === 'left' ? 0 : label.textAlign === 'right' ? 1 : 0.5,
          y: label.textBaseline === 'top' ? 0 : label.textBaseline === 'bottom' ? 1 : 0.5
        };
        object.renderOrder = label.priority || 0;
        const position = new Giro3D.Coordinates(
          Giro3D.CoordinateSystem.epsg4326,
          label.coordinate[0], label.coordinate[1]
        ).as(Giro3D.CoordinateSystem.epsg4978).toVector3();
        object.position.copy(position);
        // Giro3D manages its own matrix updates (matrixWorldAutoUpdate false),
        // so publish the local matrix as the world matrix (globe at origin).
        object.updateMatrix();
        object.matrixWorld.copy(object.matrix);
        instance.scene.add(object);
        // Anchor dot for labels that carry a symbol icon in the style (the
        // ol-mapbox-style equivalent): it marks where the billboard is placed.
        let dotObject = null;
        let dotElement = null;
        const dot = H.labelDot(label);
        if (dot) {
          dotObject = new Object3D();
          dotElement = document.createElement('div');
          dotElement.style.width = dot.diameter + 'px';
          dotElement.style.height = dot.diameter + 'px';
          dotElement.style.borderRadius = '50%';
          dotElement.style.background = dot.color;
          dotElement.style.position = 'absolute';
          dotElement.style.pointerEvents = 'none';
          dotElement.style.userSelect = 'none';
          dotObject.isCSS2DObject = true;
          dotObject.element = dotElement;
          dotObject.center = { x: 0.5, y: 0.5 };
          dotObject.position.copy(position);
          dotObject.updateMatrix();
          dotObject.matrixWorld.copy(dotObject.matrix);
          instance.scene.add(dotObject);
        }
        return { object: object, element: element, dotObject: dotObject, dotElement: dotElement };
      },
      removeLabel: function (handle) {
        instance.scene.remove(handle.object);
        if (handle.element && handle.element.parentNode) {
          handle.element.parentNode.removeChild(handle.element);
        }
        if (handle.dotObject) {
          instance.scene.remove(handle.dotObject);
        }
        if (handle.dotElement && handle.dotElement.parentNode) {
          handle.dotElement.parentNode.removeChild(handle.dotElement);
        }
      }
    });

    // Styled color layer (terrain is added separately by activateTerrain, so
    // globe and terrain problems/logs stay separated).
    const openfreemapAdapter = new Giro3DMapboxTileAdapter({
      provider: provider,
      instance: instance,
      // The "tiles" combo filters which source-layer is drawn in the tile
      // bitmap (null = all).
      tileLayers: typeof options.tileFilter === 'function' ? options.tileFilter() : null,
      maxCachedTiles: deviceProfile.maxCachedTiles
    });
    // Kept in closure variables so setTileFilter can swap them.
    let stateOpenfreemapAdapter = openfreemapAdapter;
    let stateOpenfreemapLayer = openfreemapAdapter.createColorLayer({
      name: 'OpenFreeMap Liberty'
    });
    const openfreemapLayer = stateOpenfreemapLayer;
    await globe.addLayer(openfreemapLayer);

    const controls = new Giro3D.GlobeControls({
      scene: instance.scene,
      camera: instance.view.camera,
      domElement: instance.domElement
    });

    instance.view.setControls(controls);
    // The local UMD build does not schedule the main loop for wheel events.
    instance.domElement.addEventListener('wheel', function () {
      instance.notifyChange();
    }, { passive: true });
    instance.notifyChange();
    instance.render();

    // ---- View-based label updates (getLabelsForView) -----------------------
    // When the camera moves (debounced + keyed), hand the worker the visible
    // extent + the equivalent 2D zoom. It renders the WHOLE extent in one pass
    // and returns the already-decluttered label set.
    let lastGiro3dLabelKey = '';
    let giro3dLabelViewTimer = null;
    function currentGiro3dLabelView() {
      const extent = giro3dViewExtent(instance.view.camera, instance.domElement);
      const zoom = giro3dCameraZoom(instance);
      if (!extent || zoom === null) {
        return null;
      }
      return {
        extent: extent,
        zoom: zoom,
        resolution: H.labelViewResolution(deviceProfile, instance.domElement.clientWidth || instance.domElement.width || 800)
      };
    }
    function scheduleGiro3dLabelView() {
      const view = currentGiro3dLabelView();
      if (!view) {
        return;
      }
      // Key = rounded extent + zoom + canvas width, so tiny camera jitter does
      // not re-fetch.
      const key = view.extent.map(function (v) { return v.toFixed(2); }).join(',') +
        '|' + view.zoom.toFixed(1) + '|' + view.resolution;
      if (key === lastGiro3dLabelKey) {
        return;
      }
      lastGiro3dLabelKey = key;
      if (giro3dLabelViewTimer) {
        clearTimeout(giro3dLabelViewTimer);
      }
      giro3dLabelViewTimer = setTimeout(function () {
        labelLayer.setView({ extent: view.extent, zoom: view.zoom, resolution: view.resolution });
      }, deviceProfile.constrained ? 400 : 150);
    }
    if (controls && typeof controls.addEventListener === 'function') {
      controls.addEventListener('change', scheduleGiro3dLabelView);
    }
    const giro3dLabelSyncTimer = setInterval(scheduleGiro3dLabelView, 1500);
    scheduleGiro3dLabelView();

    return {
      instance: instance,
      globe: globe,
      provider: provider,
      layer: openfreemapLayer,
      labelLayer: labelLayer,
      elevationLayer: null,
      labelSyncTimer: giro3dLabelSyncTimer,
      // Re-fetches the label set for the current camera immediately.
      refreshLabels: function () {
        const view = currentGiro3dLabelView();
        if (view) {
          labelLayer.setView({ extent: view.extent, zoom: view.zoom, resolution: view.resolution });
        }
      },
      // Re-applies the TILE source-layer filter: the color layer is re-created
      // with the new filter so only that source-layer is drawn.
      setTileFilter: function (layers) {
        const oldLayer = stateOpenfreemapLayer;
        const newAdapter = new Giro3DMapboxTileAdapter({
          provider: provider,
          instance: instance,
          tileLayers: layers || null,
          maxCachedTiles: deviceProfile.maxCachedTiles
        });
        const newLayer = newAdapter.createColorLayer({ name: 'OpenFreeMap Liberty' });
        globe.removeLayer(oldLayer);
        globe.addLayer(newLayer).then(function () {
          stateOpenfreemapLayer = newLayer;
          stateOpenfreemapAdapter = newAdapter;
          instance.notifyChange();
        });
      }
    };
  }

  // Adds the Re:Earth elevation layer to an already-running Giro3D globe.
  async function activateGiro3dTerrain(state) {
    if (!state || state.elevationLayer) {
      return state;
    }
    const instance = state.instance;
    const globe = state.globe;
    console.log('[giro3d terrain] requesting Re:Earth Mapbox Terrain-RGB elevation tiles...');
    // The format belongs to the SOURCE: TiledImageSource.loadTile() reads
    // this.format to decode the PNG bytes into heights.
    const elevationSource = new Giro3D.TiledImageSource({
      source: new ol.source.XYZ({
        projection: 'EPSG:3857',
        url: 'https://terrain.reearth.land/mapbox/ellipsoid/{z}/{x}/{y}.png'
      }),
      format: new Giro3D.MapboxTerrainFormat()
    });
    const elevationLayer = new Giro3D.ElevationLayer({
      name: 'reearth-elevation',
      source: elevationSource
    });
    await globe.addLayer(elevationLayer);
    state.elevationLayer = elevationLayer;
    console.log('[giro3d terrain] elevation layer added, decoding heights...');

    // Report the decoded min/max once the first tiles are processed.
    const startedAt = Date.now();
    const timer = setInterval(function () {
      const minmax = elevationLayer.minmax;
      if (minmax && !minmax.isDefault) {
        clearInterval(timer);
        console.log('[giro3d terrain] min/max decoded:', JSON.stringify(minmax));
      } else if (Date.now() - startedAt > 20000) {
        clearInterval(timer);
      }
    }, 500);
    return state;
  }

  // Removes the elevation layer again, restoring the flat globe.
  async function deactivateGiro3dTerrain(state) {
    if (!state || !state.elevationLayer) {
      return state;
    }
    const globe = state.globe;
    console.log('[giro3d terrain] removing the elevation layer...');
    globe.removeLayer(state.elevationLayer);
    state.elevationLayer = null;
    return state;
  }

  root.OlMapbox3DGlobe.register('giro3d', {
    create: createGiro3d,
    activateTerrain: activateGiro3dTerrain,
    deactivateTerrain: deactivateGiro3dTerrain
  });
})(typeof globalThis === 'undefined' ? window : globalThis);
