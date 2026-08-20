(function (root) {
  'use strict';

  /*
   * ol-mapbox-3d-provider — OlMapbox3DProvider (main entry module)
   *
   * One provider per Mapbox style that turns the style into ready-to-use
   * products for 3D / globe libraries (Giro3D, Cesium, OpenGlobus, ...):
   *
   *   provider.getTileImage(z, x, y, options) -> Promise<ImageBitmap tile>
   *   provider.getLabels(z, x, y, options)    -> Promise<label data>     (phase 2)
   *   provider.getObjects3D(z, x, y, options) -> Promise<3D object data> (phase 3)
   *
 * Tile bitmaps and view label sets come from TWO worker runtimes per provider
 * (a tile pool and a label pool): the style is applied once per worker, but
 * the heavy whole-view label renders never block tile composition. The globe
   * engines never see OpenLayers: they receive an ImageBitmap (raster), plain
   * label objects and georeferenced 3D objects; turning those into
   * textures / billboards / meshes is entirely the globe's business.
   *
   * Device handling is automatic: a three-tier capability profile (aggressive /
   * balanced / constrained) is derived from hardware signals (device RAM, CPU
   * cores, pixel ratio, OffscreenCanvas support) — no user-agent sniffing.
   * The profile tunes the composed-tile resolution, the worker pool, the
   * in-flight concurrency limit and the LRU cache size.
   *
   * Tile-serving contract (mirrors how OpenLayers serves raster tiles):
   *   1. A globe asks for a tile: getTileImage(z, x, y, {caller, signal, resolution}).
   *   2. The request is forwarded to the shared worker, which renders the tile
   *      with ol-mapbox-style (all the style layers composed for that tile).
   *   3. The tile is provided (resolved) only when it is ready. The request
   *      stays pending as long as needed — it is NEVER dropped by a timeout —
   *      and is interrupted only when the caller aborts it with an AbortSignal
   *      (typically because the user changed the view).
   */

  var projectionCode = 'EPSG:3857';

  // Short human-readable reason for a failed tile request, used in the logs.
  function errorReason(error) {
    if (error && error.message) {
      var message = String(error.message);
      return message.length > 80 ? message.slice(0, 80) + '…' : message;
    }
    return 'unknown error';
  }

  /*
   * Three-tier device capability profile. No UA sniffing: reads the same
   * constants OpenLayers itself uses (ol.has.DEVICE_PIXEL_RATIO,
   * ol.has.WORKER_OFFSCREEN_CANVAS) plus standard hardware signals
   * (navigator.hardwareConcurrency, navigator.deviceMemory).
   *
   *   aggressive  — powerful desktop: 512px tiles, 2 tile workers + 2 label
   *                 workers, concurrency 4, large LRU cache.
   *   balanced    — laptop / tablet: 256px tiles, 2 tile workers, 1 label
   *                 worker, concurrency 3, medium cache.
   *   constrained — phone / low-RAM: 256px tiles, 1 tile worker, 1 label
   *                 worker, concurrency 1, small LRU cache.
   *
   * Every worker holds a full ol-mapbox-style map, so workerCount is kept low
   * on constrained devices on purpose: composition is CPU-bound (more workers
   * would parallelize it), but memory is the phone's real bottleneck — each
   * extra worker costs tens of MB and can tip a low-RAM tab into a crash.
   */
  function getDeviceProfile() {
    var dpr = (typeof ol !== 'undefined' && ol.has && ol.has.DEVICE_PIXEL_RATIO)
      ? ol.has.DEVICE_PIXEL_RATIO
      : (window.devicePixelRatio || 1);
    var cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 1;
    var memory = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 4; // GB (Chromium)
    var offscreenCanvas = !!(ol.has && ol.has.WORKER_OFFSCREEN_CANVAS);
    var tier, cfg;
    if (dpr >= 1.5 && cores <= 8 && memory <= 8) {
      tier = 'constrained';
      cfg = {
        resolution: 256, workerCount: 1, maxConcurrency: 1,
        maxCachedTiles: 32, pixelRatio: Math.min(dpr, 1), antialias: false,
        // Small buffer: it only needs to cover the anti-aliasing / halo bleed
        // of labels whose glyphs touch the tile border (the delivered bitmap
        // is CROPPED back to `resolution`, so a large buffer is pure waste).
        bufferPixels: 8,
        // Decoded-MVT tiles kept per vector source in the tile worker. OL's
        // default is 512 — far too many for a worker that renders one tile at
        // a time; this bound is the main memory fix for phone crashes.
        sourceCacheTiles: 24,
        labelWorkerCount: 1
      };
    } else if (cores >= 8 && memory >= 8) {
      tier = 'aggressive';
      cfg = {
        resolution: 512, workerCount: 2, maxConcurrency: 4,
        maxCachedTiles: 256, pixelRatio: Math.min(dpr, 2), antialias: true,
        bufferPixels: 16,
        sourceCacheTiles: 96,
        // 2 label workers: the three globes each render whole-view label sets
        // on camera change, and with per-caller pinning two globes can render
        // views in parallel instead of serializing on one runtime.
        labelWorkerCount: 2
      };
    } else {
      tier = 'balanced';
      // 2 workers so tile composition is not fully serialized (a single
      // worker makes fast panning feel slow: each tile waits for the previous
      // one to finish). Balanced = laptop/desktop with a few cores; 2 workers
      // is safe and roughly doubles tile throughput.
      cfg = {
        resolution: 256, workerCount: 2, maxConcurrency: 3,
        maxCachedTiles: 64, pixelRatio: Math.min(dpr, 2), antialias: true,
        bufferPixels: 16,
        sourceCacheTiles: 48,
        labelWorkerCount: 1
      };
    }
    return {
      // Capability tier (aggressive | balanced | constrained).
      tier: tier,
      // True on high-DPI / modest-RAM devices (typically phones and tablets).
      constrained: tier === 'constrained',
      // Device pixel ratio as seen by OpenLayers.
      devicePixelRatio: dpr,
      // Whether OffscreenCanvas is available in workers on this device.
      offscreenCanvas: offscreenCanvas,
      // Composed tile bitmap size in pixels (512 aggressive / 256 otherwise).
      resolution: cfg.resolution,
      // Persistent worker pool size (each worker runs a full ol-mapbox-style map).
      workerCount: cfg.workerCount,
      // Maximum tile compositions in flight at once; the rest wait in a LIFO queue.
      maxConcurrency: cfg.maxConcurrency,
      // LRU cache size of composed tiles (bitmaps). Small but never 0.
      maxCachedTiles: cfg.maxCachedTiles,
      // Extra pixels rendered around each tile. Only needs to cover the
      // anti-aliasing / halo bleed of glyphs touching the tile border: the
      // worker CROPS the delivered bitmap back to `resolution`, so anything
      // beyond ~8-16px is pure render cost. Tuned per tier (more on desktop
      // for the larger 512px tiles, less on phones).
      bufferPixels: cfg.bufferPixels,
      // Decoded-MVT tiles kept per vector source in the tile worker. Bounds
      // the worker's real memory hog (OL's default is 512 tiles).
      sourceCacheTiles: cfg.sourceCacheTiles,
      // Label worker pool size (whole-view label renders).
      labelWorkerCount: cfg.labelWorkerCount,
      // Rendering resolution cap to hand to the 3D globes' WebGL drawing buffer.
      pixelRatio: cfg.pixelRatio,
      // Antialias recommendation for the 3D globes.
      antialias: cfg.antialias
    };
  }

  // Detects the best available WebGL context type, or null when WebGL is
  // unavailable. Mirrors the check in ol-mapbox-globes.js so the device
  // profile log can report it here too.
  function getWebGLSupport() {
    try {
      var canvas = document.createElement('canvas');
      var gl2 = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false });
      if (gl2) {
        return 'webgl2';
      }
      var gl1 = canvas.getContext('webgl', { failIfMajorPerformanceCaveat: false }) ||
        canvas.getContext('experimental-webgl');
      return gl1 ? 'webgl' : null;
    } catch (error) {
      return null;
    }
  }

  // One console summary of the auto-tuned capability tier and every knob it
  // drives (tile resolution, pixel-ratio cap, worker pools, antialias, WebGL).
  // Runs automatically on every OlMapbox3DProvider, so a page never needs to
  // call getDeviceProfile() just to see the profile.
  function logDeviceProfile(profile) {
    console.log(
      '[ol-mapbox-providers] device profile: ' + profile.tier +
      ' | tile: ' + profile.resolution + 'px' +
      ' | pixelRatio: ' + profile.devicePixelRatio.toFixed(2) + ' (capped ' + profile.pixelRatio + 'x)' +
      ' | tileWorkers: ' + profile.workerCount +
      ' | labelWorkers: ' + profile.labelWorkerCount +
      ' | maxConcurrency: ' + profile.maxConcurrency +
      ' | tileCache: ' + profile.maxCachedTiles +
      ' | antialias: ' + profile.antialias +
      ' | offscreenCanvas: ' + profile.offscreenCanvas +
      ' | webgl: ' + (getWebGLSupport() || 'none')
    );
  }

  // Wraps a promise so it rejects with AbortError when the signal aborts,
  // without cancelling the underlying request (used for shared/pending tiles
  // where only the first consumer owns the actual worker request).
  function withAbort(promise, signal) {
    if (!signal) {
      return promise;
    }
    return new Promise(function (resolve, reject) {
      var onAbort = function () {
        reject(new DOMException('Tile request aborted.', 'AbortError'));
      };
      if (signal.aborted) {
        reject(new DOMException('Tile request aborted.', 'AbortError'));
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(function (value) {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      }, function (error) {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      });
    });
  }

  function cloneTileImage(tile) {
    if (typeof createImageBitmap !== 'function') {
      return Promise.resolve(tile);
    }
    return createImageBitmap(tile.image).then(function (image) {
      return {
        image: image,
        labels: tile.labels || [],
        z: tile.z,
        x: tile.x,
        y: tile.y,
        extent: tile.extent,
        projection: tile.projection
      };
    });
  }

  function OlMapbox3DProvider(options) {
    options = options || {};
    if (!options.style) {
      throw new Error('OlMapbox3DProvider requires a style URL or object.');
    }
    var profile = getDeviceProfile();
    this.style = options.style;
    this.profile = profile;
    // Composed tile bitmap size in pixels. Default = device profile (512 on
    // aggressive desktops, 256 otherwise); pass resolution/tileSize to override.
    this.resolution = options.resolution || options.tileSize || profile.resolution;
    this.workerUrl = options.workerUrl || null;
    // Separate pool for whole-view LABEL renders: they are heavy and must
    // never block tile composition. Views are debounced and "latest view wins"
    // per caller, and each caller is PINNED to one label worker so its stale
    // views are always cancellable; the pool size only parallelizes views of
    // DIFFERENT callers (the 3 globes). Default from the device profile (2 on
    // powerful desktops, 1 elsewhere); pass labelWorkerUrl to point at the
    // dedicated label worker script.
    this.labelWorkerUrl = options.labelWorkerUrl || options.workerUrl || null;
    this.labelWorkerCount = options.labelWorkerCount === undefined
      ? profile.labelWorkerCount : options.labelWorkerCount;
    this.workerCount = options.workerCount === undefined ? profile.workerCount : options.workerCount;
    // Maximum tile compositions in flight at once (the rest wait in a LIFO
    // queue). Default from the device profile (4 aggressive / 2 balanced /
    // 1 constrained) so a phone never spawns dozens of concurrent renders.
    this.maxConcurrency = options.maxConcurrency === undefined ? profile.maxConcurrency : options.maxConcurrency;
    this.maxCachedTiles = options.maxCachedTiles === undefined ? profile.maxCachedTiles : options.maxCachedTiles;
    this.bufferPixels = options.bufferPixels !== undefined ? options.bufferPixels : profile.bufferPixels;
    // Decoded-MVT tiles kept per vector source in the tile worker (bounds the
    // worker's biggest memory consumer; see getDeviceProfile).
    this.sourceCacheTiles = options.sourceCacheTiles === undefined
      ? profile.sourceCacheTiles : options.sourceCacheTiles;
    // Worker timeout in ms. 0 (default) = disabled: a tile request stays
    // pending until the worker has finished composing the style layers, and is
    // only interrupted when the caller aborts (view change). Set a positive
    // value only if you want an explicit hard safety limit.
    this.workerTimeout = options.workerTimeout === undefined ? 0 : options.workerTimeout;
    // When true (default), the provider logs every tile request and its
    // outcome ('provided' / 'not provided') so 3D globes can be diagnosed.
    this.logEnabled = options.log === undefined ? true : !!options.log;
    // Worker-level trace (queued / render start / render done / cancel).
    // Off by default because it is very verbose; enable with workerLog: true.
    this.workerLogEnabled = options.workerLog === undefined ? false : !!options.workerLog;
    // (Phase 3) 3D objects are only produced from this zoom level on.
    this.objects3dMinZoom = (options.objects3d && options.objects3d.minZoom) || 17;
    // Optional source-layer (mvt:layer) filter for the composed tile bitmap.
    // null/undefined = every layer is drawn. Pass e.g. ['road', 'building'] to
    // get a tile containing only those layers. Overridable per request.
    this.layers = options.layers || null;
    // Optional source-layer filter for getLabels(). null = all labels.
    // Overridable per request.
    this.labelLayers = options.labelLayers || null;
    // Master switch for the LINE-label bake (street / river names drawn INTO
    // the tile bitmap by ol-mapbox-style). false = tiles are rendered without
    // any baked line labels (the "no labels" filter in the examples). See setLabelBake.
    this.labelsEnabled = options.labelsEnabled !== false;

    // Worker runtimes: a tile pool (composition is the hot path) and a
    // separate label pool for whole-view renders. They never block each other.
    this.workers = [];
    this.workerIndex = 0;
    this.workerRequests = new Map();
    this.labelWorkers = [];
    this.labelWorkerIndex = 0;
    // caller (globe) -> label worker index. Each caller is pinned to ONE label
    // worker so its "latest view wins" cancellation always works (with a plain
    // round-robin, a caller's new view could land on another worker while the
    // stale one still renders). Different callers spread across the pool.
    this.labelWorkerByCaller = {};
    this.labelRequests = new Map();
    this.workerRequestId = 0;
    // Concurrency limiter.
    this.activeRequests = 0;
    this.pendingQueue = [];
    // LRU of composed tiles.
    this.tileCache = new Map();
    this.tileCacheOrder = [];
    this.pendingTiles = new Map();

    logDeviceProfile(profile);
    if (this.logEnabled) {
      console.log('[ol-mapbox-providers] OlMapbox3DProvider ready (' + profile.tier + '), tile logging enabled');
    }
    // Always list the style's source-layers so the user can read the console
    // and pick which layers to draw (getTileImage `layers`) or which labels to
    // return (getLabels `layers`). This is the authoritative list: every
    // source-layer name in the style, with the number of style layers that use it.
    this.logStyleSourceLayers();
  }

  // Static access to the device profile, so 3D globe integrations can read the
  // same auto-tuned values (resolution, pixelRatio, workerCount, antialias)
  // without re-implementing device detection.
  OlMapbox3DProvider.getDeviceProfile = getDeviceProfile;

  OlMapbox3DProvider.prototype.setLogging = function (enabled) {
    this.logEnabled = !!enabled;
  };

  OlMapbox3DProvider.prototype.setWorkerLogging = function (enabled) {
    this.workerLogEnabled = !!enabled;
  };

  // Sets the LINE-label bake filter + switch used when composing tile bitmaps.
  // Line labels (symbol-placement: line — street / river names) are drawn INTO
  // the tile by ol-mapbox-style itself, so they follow the road with the exact
  // rotation / keep-upright / declutter of the 2D map. `layers` null = bake
  // every source-layer's line labels; `enabled` false = bake nothing ("no
  // labels"). Point labels are unaffected: they are always returned as
  // billboard data and filtered by getLabels()/getLabelsForView().
  OlMapbox3DProvider.prototype.setLabelBake = function (layers, enabled) {
    this.labelLayers = layers || null;
    this.labelsEnabled = enabled !== false;
  };

  // Logs every source-layer (mvt:layer) present in the Mapbox style, grouped by
  // the style layer ids that use them. The user reads this in the console to
  // choose what to filter: getTileImage(z,x,y,{layers:[...]}) to draw only
  // those layers, or getLabels(z,x,y,{layers:[...]}) to return only their
  // labels. Runs once per provider (fetches the style JSON when it's a URL).
  OlMapbox3DProvider.prototype.logStyleSourceLayers = function () {
    var self = this;
    // The authoritative list of source-layer (mvt:layer) names, stored so the
    // UI / globe integrations can offer a filter without re-parsing the style.
    this.sourceLayers = [];
    function report(style) {
      if (!style || !Array.isArray(style.layers)) {
        return;
      }
      var bySource = {};
      style.layers.forEach(function (layer) {
        var sourceLayer = layer['source-layer'];
        if (!sourceLayer) {
          return;
        }
        if (!bySource[sourceLayer]) {
          bySource[sourceLayer] = [];
        }
        bySource[sourceLayer].push(layer.id);
      });
      var names = Object.keys(bySource);
      self.sourceLayers = names.sort();
      if (!names.length) {
        console.log('[ol-mapbox-providers] style has no source-layers.');
        return;
      }
      console.log('[ol-mapbox-providers] style source-layers (' + names.length + '):');
      names.forEach(function (name) {
        console.log('  - ' + name + '  (' + bySource[name].length + ' style layers)');
      });
      console.log('[ol-mapbox-providers] tip: use any of the above names in getTileImage(z,x,y,{layers:[...]}) or getLabels(z,x,y,{layers:[...]}).');
    }
    if (typeof this.style === 'string') {
      fetch(this.style).then(function (response) {
        return response.json();
      }).then(report).catch(function () {
        // Style not fetchable from here (e.g. offline / CORS); the worker will
        // still render it, but we cannot list the source-layers.
        console.log('[ol-mapbox-providers] unable to fetch the style to list source-layers.');
      });
    } else {
      report(this.style);
    }
  };

  // Logs a tile request / resolution in a format like:
  //   giro3d tile request 16/34567/23456
  //   giro3d tile provided 16/34567/23456 (cache)
  //   cesium tile not provided 14/4500/6100 (worker timeout)
  OlMapbox3DProvider.prototype.logTile = function (caller, state, z, x, y, extra) {
    if (!this.logEnabled) {
      return;
    }
    var label = caller || 'provider';
    var message = label + ' tile ' + state + ' ' + z + '/' + x + '/' + y;
    if (extra) {
      message += ' (' + extra + ')';
    }
    console.log('[ol-mapbox-providers] ' + message);
  };

  OlMapbox3DProvider.prototype.touchCacheEntry = function (cacheKey) {
    var index = this.tileCacheOrder.indexOf(cacheKey);
    if (index !== -1) {
      this.tileCacheOrder.splice(index, 1);
    }
    this.tileCacheOrder.push(cacheKey);
    while (this.tileCacheOrder.length > this.maxCachedTiles) {
      var evictKey = this.tileCacheOrder.shift();
      var evicted = this.tileCache.get(evictKey);
      if (evicted && evicted.image && typeof evicted.image.close === 'function') {
        evicted.image.close();
      }
      this.tileCache.delete(evictKey);
    }
  };

  // Raster product. options: { caller, signal, resolution, layers }.
  //   - caller: optional human-readable label ('giro3d', 'cesium',
  //     'openglobus', ...) used only to make the tile logs unambiguous.
  //   - signal: optional AbortSignal — when it aborts (e.g. the 3D globe
  //     changed view), the in-flight worker request is cancelled and the
  //     promise rejects with AbortError. Without a signal the request stays
  //     pending until the worker has finished composing the style layers — it
  //     is never dropped.
  //   - resolution: composed tile size in pixels for this request (defaults to
  //     the provider's resolution, which comes from the device profile).
  //   - layers: optional array of source-layer names (mvt:layer) to draw in the
  //     tile. Omitted = draw every layer. Example: ['road', 'building'] gives
  //     a tile containing only roads and buildings.
  OlMapbox3DProvider.prototype.getTileImage = function (z, x, y, options) {
    options = options || {};
    var caller = options.caller;
    var signal = options.signal;
    var resolution = options.resolution || this.resolution;
    // The layer draw filter: per-request override wins, else provider default.
    var layers = options.layers !== undefined ? options.layers : this.layers;
    // The line-label BAKE filter + switch (street / river names drawn into the
    // tile bitmap). Per-request override wins, else provider default.
    var labelLayers = options.labelLayers !== undefined ? options.labelLayers : this.labelLayers;
    var labelsEnabled = options.labelsEnabled !== undefined ? options.labelsEnabled : this.labelsEnabled;
    // Whether this request also collects point labels (tile-mode getLabels).
    var collectLabels = options.labels === true;
    // A change in either filter (or the label-collection flag) must produce a
    // different bitmap, so all of them are part of the cache key.
    var cacheKey = [z, x, y, resolution, (layers || []).join('+'),
      (labelLayers || []).join('+'), labelsEnabled ? 'on' : 'off',
      collectLabels ? 'labels' : 'raster'].join('/');
    var self = this;
    if (signal && signal.aborted) {
      return Promise.reject(new DOMException('Tile request aborted.', 'AbortError'));
    }
    this.logTile(caller, 'request', z, x, y);

    // Fast path: tile is already cached.
    var cachedTile = this.tileCache.get(cacheKey);
    if (cachedTile) {
      this.touchCacheEntry(cacheKey);
      this.logTile(caller, 'provided', z, x, y, 'cache');
      return cloneTileImage(cachedTile);
    }

    var pending = this.pendingTiles.get(cacheKey);
    if (pending) {
      pending.consumers += 1;
      // Joining callers share the in-flight request: aborting here only rejects
      // this consumer, it does not cancel the shared worker request.
      return withAbort(pending.promise.then(cloneTileImage), signal).then(function (tile) {
        self.logTile(caller, 'provided', z, x, y);
        return tile;
      }, function (error) {
        self.logTile(caller, 'not provided', z, x, y, errorReason(error));
        throw error;
      }).finally(function () {
        self.releasePendingTile(cacheKey, pending);
      });
    }

    // New composition request, throttled by the concurrency limit.
    var request = this.schedule(function () {
      return self.getTileImageFromWorker(z, x, y, resolution, layers, caller, signal, labelLayers, labelsEnabled, collectLabels);
    }, signal);

    pending = {
      promise: request,
      consumers: 1,
      settled: false,
      tile: null
    };
    this.pendingTiles.set(cacheKey, pending);

    request.then(function (tile) {
      pending.settled = true;
      pending.tile = tile;
      // Store the resolved tile in the LRU cache so future requests for the
      // same tile skip the worker pipeline entirely. The cache is small but
      // never disabled (a small LRU is still cheaper than re-composing).
      if (self.maxCachedTiles > 0 && !self.tileCache.has(cacheKey)) {
        self.tileCache.set(cacheKey, tile);
        self.touchCacheEntry(cacheKey);
      }
    }, function () {
      pending.settled = true;
    });

    return request.then(cloneTileImage).then(function (tile) {
      self.logTile(caller, 'provided', z, x, y);
      return tile;
    }, function (error) {
      self.logTile(caller, 'not provided', z, x, y, errorReason(error));
      throw error;
    }).finally(function () {
      self.releasePendingTile(cacheKey, pending);
    });
  };

  OlMapbox3DProvider.prototype.releasePendingTile = function (cacheKey, pending) {
    pending.consumers -= 1;
    if (!pending.settled || pending.consumers > 0) {
      return;
    }
    // Only close the bitmap if it is NOT still held by the LRU tile cache.
    if (!this.tileCache.has(cacheKey)) {
      if (pending.tile && pending.tile.image &&
          typeof pending.tile.image.close === 'function') {
        pending.tile.image.close();
      }
    }
    if (this.pendingTiles.get(cacheKey) === pending) {
      this.pendingTiles.delete(cacheKey);
    }
  };

  // Tells the provider a globe no longer references this tile's bitmap, so it
  // can be evicted from the LRU cache and closed (frees GPU/JS memory).
  OlMapbox3DProvider.prototype.releaseTile = function (z, x, y, resolution) {
    var res = resolution || this.resolution;
    var cacheKey = [z, x, y, res].join('/');
    var evicted = this.tileCache.get(cacheKey);
    if (evicted) {
      if (evicted.image && typeof evicted.image.close === 'function') {
        evicted.image.close();
      }
      this.tileCache.delete(cacheKey);
      var idx = this.tileCacheOrder.indexOf(cacheKey);
      if (idx !== -1) {
        this.tileCacheOrder.splice(idx, 1);
      }
    }
  };

  OlMapbox3DProvider.prototype.clearCache = function () {
    this.tileCache.forEach(function (tile) {
      if (tile.image && typeof tile.image.close === 'function') {
        tile.image.close();
      }
    });
    this.tileCache.clear();
    this.tileCacheOrder.length = 0;
  };

  // Invalidates EVERYTHING the provider has cached or has in flight, so the
  // next requests fully re-compose with the current source-layer / label
  // filters. This is the single entry point a caller must use when a filter
  // combo changes (or any other style-dependent state):
  //   1. queued (not yet dispatched) tasks are rejected and dropped;
  //   2. in-flight worker requests (tile + view) are cancelled and rejected;
  //   3. pending tile bookkeeping is cleared (without double-closing);
  //   4. the composed-tile LRU is emptied (each bitmap is closed);
  //   5. every worker is told to drop its composed render state.
  // The browser's own HTTP cache for the source MVT tiles is intentionally
  // NOT touched (and cannot be from here); those source tiles are not
  // filter-dependent, so reusing them is correct and cheaper.
  OlMapbox3DProvider.prototype.invalidate = function () {
    var abortError = new DOMException('Tile request aborted.', 'AbortError');

    // 1) Reject queued tasks and remove their abort hooks.
    this.pendingQueue.forEach(function (entry) {
      entry.canceled = true;
      if (entry.onAbort && entry.signal) {
        entry.signal.removeEventListener('abort', entry.onAbort);
      }
      entry.reject(abortError);
    });
    this.pendingQueue.length = 0;

    // 2) Cancel and reject every in-flight worker request (tile + label view).
    this.workerRequests.forEach(function (request, id) {
      if (request.worker) {
        request.worker.postMessage({ cancel: id });
      }
      if (request.signal && request.onAbort) {
        request.signal.removeEventListener('abort', request.onAbort);
      }
      if (request.timeoutId) {
        clearTimeout(request.timeoutId);
      }
      request.reject(abortError);
    });
    this.workerRequests.clear();
    this.labelRequests.forEach(function (request, id) {
      if (request.worker) {
        request.worker.postMessage({ cancel: id });
      }
      if (request.signal && request.onAbort) {
        request.signal.removeEventListener('abort', request.onAbort);
      }
      if (request.timeoutId) {
        clearTimeout(request.timeoutId);
      }
      request.reject(abortError);
    });
    this.labelRequests.clear();

    // 3) Forget pending-tile bookkeeping. clearCache() below closes the
    //    composed bitmaps, so null the reference first to prevent a straggler
    //    releasePendingTile() from closing the same bitmap twice.
    this.pendingTiles.forEach(function (pending) {
      pending.tile = null;
    });
    this.pendingTiles.clear();

    // 4) Empty the composed-tile LRU (closes each cached bitmap).
    this.clearCache();

    // 5) Drop each worker's composed render state.
    this.resetWorkerRenderCache();
  };

  // Tells every worker to forget its composed render state (the OL per-layer
  // canvas cache and the collected labels) so the NEXT request fully
  // re-composes with the current source-layer filter. Used when a "tiles"/
  // "labels" combo changes: previously-visited zooms must never show stale
  // tiles or labels from before the filter was applied.
  OlMapbox3DProvider.prototype.resetWorkerRenderCache = function () {
    if (this.workers && this.workers.length) {
      for (var i = 0; i < this.workers.length; i += 1) {
        this.workers[i].postMessage({ reset: true });
      }
    }
    if (this.labelWorkers && this.labelWorkers.length) {
      for (var j = 0; j < this.labelWorkers.length; j += 1) {
        this.labelWorkers[j].postMessage({ reset: true });
      }
    }
  };

  // Runs a composition task under the concurrency limit. When the limit is
  // reached the task waits in a LIFO queue (most recently requested tiles are
  // most likely still needed). Queued tasks whose signal aborts (the globe
  // changed view) are dropped from the queue and reject with AbortError.
  OlMapbox3DProvider.prototype.schedule = function (task, signal) {
    var self = this;
    if (this.activeRequests < this.maxConcurrency) {
      this.activeRequests += 1;
      return task().finally(function () {
        self.activeRequests -= 1;
        self.drainQueue();
      });
    }
    return new Promise(function (resolve, reject) {
      var entry = { task: task, resolve: resolve, reject: reject, canceled: false, signal: signal || null, onAbort: null };
      if (signal) {
        if (signal.aborted) {
          reject(new DOMException('Tile request aborted.', 'AbortError'));
          return;
        }
        entry.onAbort = function () {
          entry.canceled = true;
          reject(new DOMException('Tile request aborted.', 'AbortError'));
        };
        signal.addEventListener('abort', entry.onAbort, { once: true });
      }
      self.pendingQueue.push(entry);
    });
  };

  OlMapbox3DProvider.prototype.drainQueue = function () {
    var self = this;
    while (this.activeRequests < this.maxConcurrency && this.pendingQueue.length > 0) {
      var entry = this.pendingQueue.pop();
      if (entry.canceled) {
        continue;
      }
      if (entry.onAbort) {
        entry.signal.removeEventListener('abort', entry.onAbort);
      }
      this.activeRequests += 1;
      entry.task().then(entry.resolve, entry.reject).finally(function () {
        self.activeRequests -= 1;
        self.drainQueue();
      });
    }
  };

  // Lazy-creates the TILE worker pool (raster composition). Each worker runs a
  // full ol-mapbox-style map and answers only tile render responses (bitmap +
  // optional labels). Whole-view label renders go to _ensureLabelWorkers.
  OlMapbox3DProvider.prototype._ensureWorkers = function () {
    if (!this.workerUrl) {
      throw new Error('OlMapbox3DProvider: workerUrl is required for getTileImage().');
    }
    if (this.workers.length > 0) {
      return;
    }
    var provider = this;
    for (var workerIndex = 0; workerIndex < this.workerCount; workerIndex += 1) {
      var worker = new Worker(this.workerUrl);
      worker.onmessage = function (event) {
        var data = event.data;
        var request = provider.workerRequests.get(data.id);
        if (!request) {
          if (data.bitmap && typeof data.bitmap.close === 'function') {
            data.bitmap.close();
          }
          return;
        }
        clearTimeout(request.timeoutId);
        if (request.signal && request.onAbort) {
          request.signal.removeEventListener('abort', request.onAbort);
        }
        provider.workerRequests.delete(data.id);
        if (data.ok === false || data.error) {
          request.reject(new Error(data.error || 'Worker request failed.'));
          return;
        }
        request.resolve({
          image: data.bitmap,
          labels: data.labels || [],
          z: data.z,
          x: data.x,
          y: data.y,
          extent: data.extent,
          projection: projectionCode
        });
      };
      this.workers.push(worker);
    }
  };

  // Lazy-creates the LABEL worker pool (whole-view label renders). Answers only
  // view responses (labels + extent), so a heavy whole-view render never shares
  // a runtime with tile composition.
  OlMapbox3DProvider.prototype._ensureLabelWorkers = function () {
    if (!this.labelWorkerUrl) {
      throw new Error('OlMapbox3DProvider: labelWorkerUrl is required for getLabelsForView().');
    }
    if (this.labelWorkers.length > 0) {
      return;
    }
    var provider = this;
    for (var workerIndex = 0; workerIndex < this.labelWorkerCount; workerIndex += 1) {
      var worker = new Worker(this.labelWorkerUrl);
      worker.onmessage = function (event) {
        var data = event.data;
        var request = provider.labelRequests.get(data.id);
        if (!request) {
          return;
        }
        clearTimeout(request.timeoutId);
        if (request.signal && request.onAbort) {
          request.signal.removeEventListener('abort', request.onAbort);
        }
        provider.labelRequests.delete(data.id);
        if (data.ok === false || data.error) {
          request.reject(new Error(data.error || 'Worker view request failed.'));
          return;
        }
        request.resolve({
          labels: data.labels || [],
          extent: data.extent
        });
      };
      this.labelWorkers.push(worker);
    }
  };

  OlMapbox3DProvider.prototype.getTileImageFromWorker = function (z, x, y, resolution, layers, caller, signal, labelLayers, labelsEnabled, collectLabels) {
    var provider = this;
    this._ensureWorkers();
    var selectedWorker = this.workers[this.workerIndex];
    this.workerIndex = (this.workerIndex + 1) % this.workers.length;
    var id = this.workerRequestId++;
    return new Promise(function (resolve, reject) {
      var timeoutId = null;
      var onAbort = function () {
        if (provider.workerRequests.get(id)) {
          provider.workerRequests.delete(id);
        }
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        // Tell the worker to stop this request. This only happens when the
        // caller aborts (the 3D globe changed view) — never on a timer.
        selectedWorker.postMessage({ cancel: id });
        reject(new DOMException('Tile request aborted.', 'AbortError'));
      };
      if (provider.workerTimeout > 0) {
        timeoutId = setTimeout(function () {
          provider.workerRequests.delete(id);
          // Notify the worker to cancel this request if still queued.
          selectedWorker.postMessage({ cancel: id });
          // The rejected promise propagates to getTileImage(), which logs the
          // 'not provided' outcome with the reason below.
          reject(new Error('Worker tile request timed out for ' + z + '/' + x + '/' + y));
        }, provider.workerTimeout);
      }
      provider.workerRequests.set(id, {
        resolve: resolve,
        reject: reject,
        timeoutId: timeoutId,
        worker: selectedWorker,
        signal: signal || null,
        onAbort: onAbort
      });
      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }
      selectedWorker.postMessage({
        id: id,
        style: provider.style,
        z: z,
        x: x,
        y: y,
        resolution: resolution,
        layers: layers || null,
        labelLayers: labelLayers || null,
        labelsEnabled: labelsEnabled !== false,
        labels: collectLabels === true,
        bufferPixels: provider.bufferPixels,
        // Bounds the worker's decoded-MVT source caches (see profile).
        cacheSize: provider.sourceCacheTiles,
        log: provider.workerLogEnabled,
        caller: caller || 'provider'
      });
    });
  };

  // Virtual XYZ source for globe integrations that fetch by z/x/y (Giro3D).
  OlMapbox3DProvider.prototype.createXYZSource = function () {
    return new ol.source.XYZ({
      projection: projectionCode,
      tileSize: this.resolution,
      url: 'ol-mapbox-provider://{z}/{x}/{y}.png'
    });
  };

  // Returns the ECEF unit vector [x, y, z] of a label's LINE direction at
  // (lon, lat) for a given Web-Mercator `lineAngle` (0 = east, counter-clockwise
  // positive — the value ol-mapbox-style uses for `symbol-placement: line`).
  // A globe projects this direction onto the screen (via its own camera) to
  // rotate its billboard along the road, exactly like ol-mapbox-style draws
  // street names in 2D. This is pure math, engine-agnostic: the globe only
  // needs to add this vector to the anchor's ECEF position and project both.
  OlMapbox3DProvider.prototype.lineEcefDirection = function (lon, lat, lineAngle) {
    var lonR = lon * Math.PI / 180;
    var latR = lat * Math.PI / 180;
    // Local East / North unit vectors at the anchor (in ECEF).
    var east = [-Math.sin(lonR), Math.cos(lonR), 0];
    var north = [
      -Math.sin(latR) * Math.cos(lonR),
      -Math.sin(latR) * Math.sin(lonR),
      Math.cos(latR)
    ];
    var ca = Math.cos(lineAngle);
    var sa = Math.sin(lineAngle);
    return [
      east[0] * ca + north[0] * sa,
      east[1] * ca + north[1] * sa,
      east[2] * ca + north[2] * sa
    ];
  };

  /*
   * Internal unified elaboration. One worker pass can produce a bitmap, label
   * data and 3D object data; `products` selects which are computed. In the
   * current phase only the raster bitmap is produced — labels and objects are
   * added by the next phases without changing this API.
   *   getTile(z, x, y, { products: ['raster', 'labels', 'objects3d'] })
   *   -> { bitmap, labels, objects3d, z, x, y, extent, projection }
   */
  OlMapbox3DProvider.prototype.getTile = function (z, x, y, options) {
    options = options || {};
    var products = options.products || ['raster'];
    var self = this;
    // The same per-request layer filter as getLabels (used when 'labels' is
    // among the requested products).
    var labelLayers = options.layers !== undefined ? options.layers : this.labelLayers;
    var requestOptions = Object.assign({}, options, {
      labels: products.indexOf('labels') !== -1
    });
    return this.getTileImage(z, x, y, requestOptions).then(function (tile) {
      var labels = tile.labels || [];
      if (labelLayers && labelLayers.length) {
        labels = labels.filter(function (label) {
          var layerName = label.properties && (label.properties['mvt:layer'] || label.properties.layer);
          return labelLayers.indexOf(layerName) !== -1;
        });
      }
      return {
        bitmap: tile.image,
        z: tile.z,
        x: tile.x,
        y: tile.y,
        extent: tile.extent,
        projection: tile.projection,
        labels: products.indexOf('labels') !== -1 ? labels : null,
        objects3d: products.indexOf('objects3d') !== -1 ? [] : null
      };
    });
  };

  // Label product: returns billboard data for the tile, e.g.
  // [{ id, coordinate: [lon, lat], text, font, color, size, rotation, properties }].
  // The labels are collected by the worker during the SAME render pass that
  // produces the tile bitmap, so requesting them never triggers a second
  // rendering — it only reuses the tile's in-flight / cached result.
  // options.layers / this.labelLayers: optional array of source-layer names
  // (mvt:layer) — when set, only the labels of those layers are returned
  // (e.g. ['place', 'housenumber'] = city names + house numbers only).
  OlMapbox3DProvider.prototype.getLabels = function (z, x, y, options) {
    options = options || {};
    var self = this;
    // Per-request label filter wins, else the provider default.
    var labelLayers = options.layers !== undefined ? options.layers : this.labelLayers;
    var requestOptions = Object.assign({}, options, { labels: true });
    return this.getTileImage(z, x, y, requestOptions).then(function (tile) {
      var labels = tile.labels || [];
      if (labelLayers && labelLayers.length) {
        labels = labels.filter(function (label) {
          var layerName = label.properties && (label.properties['mvt:layer'] || label.properties.layer);
          return labelLayers.indexOf(layerName) !== -1;
        });
      }
      return labels;
    });
  };

  // View-level label product: returns the label set ol-mapbox-style would
  // draw for the given geographic view, ready to render — the SAME result the
  // 2D map shows for the same extent and zoom.
  //
  //   getLabelsForView([west, south, east, north], zoom, {
  //     resolution,    // view width in pixels (e.g. the globe's canvas width)
  //     layers,        // optional source-layer filter (mvt:layer)
  //     caller         // log label
  //   })
  //   -> Promise<[ {id, coordinate:[lon,lat], text, font, color, size,
  //                 haloColor, haloWidth, offsetX, offsetY, textAlign,
  //                 textBaseline, placement, rotation, priority, properties} ]>
  //
  // The worker renders the WHOLE extent in a single pass (it sets the OpenLayers
  // map to that view, exactly like the 2D map), collects every label that would
  // be drawn, and runs ONE declutter over the whole extent — so the returned
  // labels are already non-overlapping and priority-ordered. The globe only
  // renders them and hides the ones that fall behind the globe / off the
  // canvas; it never re-implements declutter. Call it when the camera moves
  // (debounced), not on every frame.
  OlMapbox3DProvider.prototype.getLabelsForView = function (extentLonLat, zoom, options) {
    options = options || {};
    var resolution = options.resolution || this.resolution;
    var layers = options.layers !== undefined ? options.layers : this.labelLayers;
    // Convert the lon/lat extent to Web-Mercator (the worker's tile space).
    var extent = ol.proj.transformExtent(extentLonLat, 'EPSG:4326', 'EPSG:3857');
    // Clamp to the world extent so the worker's map view stays valid.
    var world = 20037508.342789244;
    extent[0] = Math.max(extent[0], -world);
    extent[1] = Math.max(extent[1], -world);
    extent[2] = Math.min(extent[2], world);
    extent[3] = Math.min(extent[3], world);
    return this.getViewLabelsFromWorker(extent, resolution, layers, options.caller, options.signal).then(function (result) {
      var labels = result.labels || [];
      // The source-layer filter is applied client-side (the worker always
      // collects every label; `layers` there only controls the tile draw).
      if (layers && layers.length) {
        labels = labels.filter(function (label) {
          var layerName = label.properties && (label.properties['mvt:layer'] || label.properties.layer);
          return layers.indexOf(layerName) !== -1;
        });
      }
      return labels;
    });
  };

  // Sends ONE "view" request to the LABEL worker pool (mode:'view'): render
  // the whole extent and return the globally-decluttered labels. This runs on
  // its own runtime, so it never blocks tile composition. `signal` (optional)
  // aborts the in-flight view when the caller supersedes it.
  OlMapbox3DProvider.prototype.getViewLabelsFromWorker = function (extent, resolution, layers, caller, signal) {
    var provider = this;
    this._ensureLabelWorkers();
    // Pin the caller to one label worker (see labelWorkerByCaller): consecutive
    // views of the same globe must land on the same worker so "latest view
    // wins" can cancel the stale one; different globes spread across the pool.
    var callerKey = caller || 'provider';
    if (this.labelWorkerByCaller[callerKey] === undefined) {
      this.labelWorkerByCaller[callerKey] = this.labelWorkerIndex % this.labelWorkers.length;
      this.labelWorkerIndex += 1;
    }
    var selectedWorker = this.labelWorkers[this.labelWorkerByCaller[callerKey]];
    var id = this.workerRequestId++;
    return new Promise(function (resolve, reject) {
      var timeoutId = null;
      var onAbort = function () {
        if (provider.labelRequests.get(id)) {
          provider.labelRequests.delete(id);
        }
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        selectedWorker.postMessage({ cancel: id });
        reject(new DOMException('View request aborted.', 'AbortError'));
      };
      if (provider.workerTimeout > 0) {
        timeoutId = setTimeout(function () {
          provider.labelRequests.delete(id);
          selectedWorker.postMessage({ cancel: id });
          reject(new Error('Worker view request timed out.'));
        }, provider.workerTimeout);
      }
      provider.labelRequests.set(id, {
        resolve: resolve,
        reject: reject,
        timeoutId: timeoutId,
        worker: selectedWorker,
        signal: signal || null,
        onAbort: onAbort
      });
      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }
      selectedWorker.postMessage({
        id: id,
        mode: 'view',
        style: provider.style,
        extent: extent,
        resolution: resolution,
        layers: layers || null,
        log: provider.workerLogEnabled,
        caller: caller || 'provider'
      });
    });
  };

  // ---- Label layer (phase 2: rendering getLabels() on a globe) ------------
  //
  // A small engine-agnostic helper that turns getLabels() output into
  // billboards. The globe feeds it which tiles are currently visible
  // (addTile / removeTile — typically from its own tile lifecycle) and it
  // renders each label with two tiny callbacks:
  //
  //   - addLabel(label)   -> opaque handle  (create a billboard)
  //   - removeLabel(handle) -> void          (destroy that billboard)
  //
  // It deduplicates the same feature across neighbouring tiles (a label near
  // a tile edge can be produced by two tiles), keeps a hard cap on the total
  // number of billboards and honours the `layers` filter of getLabels().
  function OlMapbox3DLabelLayer(provider, options) {
    options = options || {};
    this.provider = provider;
    this.caller = options.caller || 'labels';
    // Source-layer filter (mvt:layer) forwarded to getLabels(). null = all.
    this.layers = options.layers || null;
    this.addLabel = options.addLabel || function () { return null; };
    this.removeLabel = options.removeLabel || function () {};
    // Called once after every label-set diff (adds and/or removes). Giro3D's
    // CSS2D renderer only projects a billboard when a frame is drawn, but the
    // globe's render loop is on-demand and is typically PAUSED by the time the
    // worker's async label set arrives — so new/changed billboards would sit
    // unprojected (empty CSS transform) until some unrelated tile re-triggers a
    // render. Engines that render continuously (Cesium, OpenGlobus) can leave
    // this unset; Giro3D uses it to force one render after each diff.
    this.onLabelsChanged = options.onLabelsChanged || function () {};
    this.maxLabels = options.maxLabels || 4000;
    this.tiles = new Map();   // tileKey -> { z, x, y, handles: [], keys: [] }
    this.pending = new Map(); // tileKey -> Promise (label fetch in flight)
    this.seen = new Map();    // dedupKey -> { handle, tileKey, zoom }
    // Every tile whose labels were fetched (or skipped by the zoom window),
    // so setPreferredZoom / setLayers can re-evaluate them when the globe's
    // zoom or the layer filter changes. A tile whose labels were skipped must
    // stay here (with no entry in `tiles`) so it can come back later.
    this.fetched = new Map(); // tileKey -> { z, x, y }
    this.totalLabels = 0;
    // Master switch: when false, no label is fetched or rendered (setView /
    // addTile become no-ops and setEnabled(false) clears the current
    // billboards). Used by the "no labels" filter to measure the
    // cost of the label pipeline in isolation.
    this.enabled = true;
    // The zoom level the globe is currently looking at (set by the globe via
    // setPreferredZoom). When the same feature is seen in several tiles, the
    // version whose zoom is closest to this value is kept — mirroring how the
    // 2D map only shows the CURRENT zoom's label. null = keep the first seen
    // (backwards-compatible default for globes that do not set it).
    this.preferredZoom = null;
    // Zoom window: when set (and preferredZoom is set), tiles whose zoom is
    // more than `zoomTolerance` levels BELOW the preferred zoom are skipped
    // entirely. A 3D globe keeps the low-zoom base of the pyramid on screen
    // for the imagery, but the 2D map only draws the labels of its CURRENT
    // zoom — so the coarse base tiles' labels (whole-world country names)
    // must not be drawn on top of the local detail. 0 = disabled (keep every
    // fetched tile, backwards-compatible default).
    this.zoomTolerance = options.zoomTolerance || 0;
  }

  OlMapbox3DLabelLayer.prototype = {
    constructor: OlMapbox3DLabelLayer,

    _tileKey: function (z, x, y) {
      return z + '/' + x + '/' + y;
    },

    // A label is deduplicated by source-layer + text + anchor coordinate, so
    // a feature that straddles a tile boundary is rendered only once.
    _dedupKey: function (label) {
      var layerName = label.properties && (label.properties['mvt:layer'] || label.properties.layer);
      var c = label.coordinate || [0, 0];
      return (layerName || '') + '|' + (label.text || '') +
        '|' + Number(c[0]).toFixed(4) + '|' + Number(c[1]).toFixed(4);
    },

    // Master switch for the whole label pipeline. Disabling clears the
    // current billboards and stops setView/addTile from fetching anything (the
    // globes keep calling them, they just become no-ops). Enabling again does
    // NOT re-fetch by itself: the caller re-issues its view/tiles right after
    // (each globe does this via its refreshLabels).
    setEnabled: function (enabled) {
      this.enabled = !!enabled;
      if (!this.enabled) {
        this.clear();
      }
    },

    // Changes the `layers` filter and re-fetches the current view (or every
    // currently-visible tile when in tile mode).
    setLayers: function (layers) {
      this.layers = layers || null;
      // View mode: re-fetch the current view with the new filter.
      if (this.currentView) {
        var view = this.currentView;
        this.setView({
          extent: view.extent,
          zoom: view.zoom,
          resolution: view.resolution,
          layers: this.layers
        });
        return;
      }
      // Tile mode: re-fetch every tile whose labels were fetched (including
      // the ones the zoom window skipped, so they get re-evaluated with the
      // new filter).
      var keys = Array.from(this.fetched.keys());
      this.clear();
      var self = this;
      keys.forEach(function (key) {
        var parts = key.split('/').map(Number);
        self.addTile(parts[0], parts[1], parts[2]);
      });
    },

    // VIEW-BASED label mode: renders the whole label set of a geographic view
    // at once, exactly like the 2D map. `view` = { extent: [west, south, east,
    // north] (lon/lat), zoom, resolution (view width in px, e.g. the globe's
    // canvas width), layers? }. The provider fetches the already-decluttered
    // labels from the worker (getLabelsForView) and this method DIFFS them
    // against the current billboards: unchanged labels keep their handle (no
    // flicker), new ones are added and stale ones removed. The globe calls it
    // only when the camera actually moves (debounced) — never per-frame.
    setView: function (view) {
      if (!this.enabled) {
        return;
      }
      this.currentView = view || null;
      var self = this;
      if (!view) {
        this.clear();
        return;
      }
      // Invalidate any in-flight view request (a newer one supersedes it).
      this._viewRequestId = (this._viewRequestId || 0) + 1;
      var requestId = this._viewRequestId;
      if (this._viewAbortController) {
        this._viewAbortController.abort();
      }
      this._viewAbortController = new AbortController();
      this.provider.getLabelsForView(view.extent, view.zoom, {
        caller: this.caller,
        layers: view.layers !== undefined ? view.layers : this.layers,
        resolution: view.resolution,
        signal: this._viewAbortController.signal
      }).then(function (labels) {
        if (self._viewRequestId !== requestId || !self.currentView) {
          return; // superseded or cleared.
        }
        self._applyViewLabels(labels || []);
      }).catch(function () {
        // A failed view fetch is transient (the worker may be busy with
        // tiles); keep the current billboards and try again on the next move.
      });
    },

    // Diff the given (already-decluttered) labels against the current
    // billboards: keep shared handles, add new labels, remove stale ones.
    _applyViewLabels: function (labels) {
      var self = this;
      var nextSeen = new Map();
      var changed = false;
      (labels || []).forEach(function (label) {
        var dedupKey = self._dedupKey(label);
        var existing = self.seen.get(dedupKey);
        if (existing) {
          // Keep the same handle (no flicker) and remember it as still wanted.
          nextSeen.set(dedupKey, existing);
          return;
        }
        if (self.totalLabels >= self.maxLabels) {
          return;
        }
        var handle = self.addLabel(label);
        if (handle) {
          nextSeen.set(dedupKey, { handle: handle, tileKey: 'view', zoom: label.zoom || 0 });
          self.totalLabels++;
          changed = true;
        }
      });
      // Remove the billboards that are no longer in the view.
      this.seen.forEach(function (entry, key) {
        if (!nextSeen.has(key)) {
          self.removeLabel(entry.handle);
          self.totalLabels--;
          changed = true;
        }
      });
      this.seen = nextSeen;
      // Let the engine repaint the (newly added/removed) billboards now that
      // the diff is complete (see the onLabelsChanged constructor note). Only
      // fire when something actually changed to avoid a wasted repaint when
      // the same label set arrives again.
      if (changed) {
        this.onLabelsChanged();
      }
    },

    // Tells the layer which zoom level the globe is currently looking at. The
    // same feature can be present in several tiles (the low-zoom base of the
    // pyramid and the camera's high-zoom detail); with this value set, when a
    // higher-zoom version of a feature is seen it REPLACES the lower-zoom one,
    // so the globe always shows the most detailed label it has, like the 2D
    // map shows the label of its current zoom. Pass null to go back to
    // "keep the first seen" (all tiles are equally valid).
    //
    // When a zoomTolerance is configured this also reconciles the current
    // billboards against the new zoom: the labels of tiles now far below it
    // (the coarse base of the pyramid) are removed, and tiles that were
    // skipped by the zoom window are re-fetched — so the globe always draws
    // the labels of the tiles near its current zoom, like the 2D map.
    setPreferredZoom: function (zoom) {
      this.preferredZoom = (zoom === undefined || zoom === null) ? null : Number(zoom);
      if (this.preferredZoom === null || this.zoomTolerance <= 0) {
        return;
      }
      var self = this;
      var minZoom = this.preferredZoom - this.zoomTolerance;
      // 1) Remove the labels of the tiles now outside the zoom window (their
      //    coarse labels are not drawn at this zoom, like in the 2D map). The
      //    tile stays in `fetched` so zooming back out brings it back.
      this.tiles.forEach(function (entry, key) {
        if (entry.z < minZoom) {
          self._removeTileEntry(key);
        }
      });
      // 2) (Re-)fetch the tiles that are now inside the window. Tiles already
      //    holding labels return early (addTile guard); the skipped ones are
      //    re-evaluated against the new preferred zoom.
      this.fetched.forEach(function (tile) {
        self.addTile(tile.z, tile.x, tile.y);
      });
    },

    // Fetches and renders the labels of one tile. Safe to call repeatedly for
    // the same tile (deduplicated), and safe to call before the previous
    // request finished (the in-flight promise is reused).
    addTile: function (z, x, y) {
      if (!this.enabled) {
        return;
      }
      var key = this._tileKey(z, x, y);
      if (this.tiles.has(key) || this.pending.has(key)) {
        return;
      }
      var self = this;
      // Zoom window: with a preferred zoom set, tiles far below it are the
      // world-wide base of the pyramid (whole countries at z1..z4 while the
      // camera looks at a valley). The 2D map only draws the labels of its
      // current zoom, so skip those tiles' labels. Remember the tile so a
      // later zoom-out (setPreferredZoom) can bring its labels back.
      if (this.zoomTolerance > 0 && this.preferredZoom !== null &&
          z < this.preferredZoom - this.zoomTolerance) {
        this.fetched.set(key, { z: z, x: x, y: y });
        return;
      }
      var promise = this.provider.getLabels(z, x, y, {
        caller: this.caller,
        layers: this.layers
      }).then(function (labels) {
        self.pending.delete(key);
        self.fetched.set(key, { z: z, x: x, y: y });
        if (self.tiles.has(key)) {
          return;
        }
        var entry = { z: z, x: x, y: y, handles: [], keys: [] };
        (labels || []).forEach(function (label) {
          var dedupKey = self._dedupKey(label);
          var existing = self.seen.get(dedupKey);
          var labelZoom = label.zoom || z;
          if (existing) {
            // The same feature can appear in several tiles (the low-zoom base
            // of the pyramid and the camera's high-zoom tiles). The 2D map
            // shows the CURRENT zoom's label, so we keep the version whose
            // zoom is CLOSEST to the globe's preferred zoom (set via
            // setPreferredZoom). A lower-zoom version of a feature that is
            // already shown at a higher zoom is ignored; a higher-zoom (or
            // closer-to-preferred) version REPLACES the one on screen.
            var keepExisting = true;
            if (self.preferredZoom !== null) {
              keepExisting =
                Math.abs(existing.zoom - self.preferredZoom) <=
                Math.abs(labelZoom - self.preferredZoom);
            } else {
              keepExisting = labelZoom <= existing.zoom;
            }
            if (keepExisting) {
              return;
            }
            // Remove the old (farther-from-preferred) billboard.
            self.removeLabel(existing.handle);
            self.totalLabels--;
            var oldEntry = self.tiles.get(existing.tileKey);
            if (oldEntry) {
              var oldIdx = oldEntry.handles.indexOf(existing.handle);
              if (oldIdx !== -1) {
                oldEntry.handles.splice(oldIdx, 1);
                oldEntry.keys.splice(oldIdx, 1);
              }
            }
            self.seen.delete(dedupKey);
          }
          // A globe loads many zoom levels at once (a low-zoom base plus the
          // camera's high-zoom tiles). When the billboard budget is full, drop
          // the labels of the LOWEST-zoom tile: they are the coarsest / least
          // relevant for the current camera view, whereas the high-zoom tiles
          // carry the detail that is actually on screen.
          if (self.totalLabels >= self.maxLabels) {
            self._evictLowestZoomTile();
          }
          if (self.totalLabels >= self.maxLabels) {
            return;
          }
          var handle = self.addLabel(label);
          if (handle) {
            self.seen.set(dedupKey, { handle: handle, tileKey: key, zoom: labelZoom, priority: label.priority || 0 });
            entry.handles.push(handle);
            entry.keys.push(dedupKey);
            self.totalLabels++;
          }
        });
        if (entry.handles.length) {
          self.tiles.set(key, entry);
        }
      }).catch(function () {
        self.pending.delete(key);
      });
      this.pending.set(key, promise);
    },

    // Removes the billboards of the tile with the lowest zoom level that still
    // has labels (the coarsest data for the current view). Frees budget for
    // the high-zoom tiles that are actually on screen.
    _evictLowestZoomTile: function () {
      var lowestKey = null;
      var lowestZ = Infinity;
      this.tiles.forEach(function (entry, key) {
        if (entry.z < lowestZ) {
          lowestZ = entry.z;
          lowestKey = key;
        }
      });
      if (lowestKey !== null) {
        var entry = this.tiles.get(lowestKey);
        var self = this;
        entry.handles.forEach(function (handle) { self.removeLabel(handle); });
        entry.keys.forEach(function (dedupKey) {
          var seen = self.seen.get(dedupKey);
          if (seen && seen.tileKey === lowestKey) {
            self.seen.delete(dedupKey);
          }
        });
        this.totalLabels -= entry.handles.length;
        this.tiles.delete(lowestKey);
      }
    },

    // Removes the billboards of one tile (the globe dropped it). Also forgets
    // the tile's fetch record: if it comes back on screen the globe re-adds it
    // and the labels are fetched again.
    removeTile: function (z, x, y) {
      var key = this._tileKey(z, x, y);
      this.fetched.delete(key);
      this._removeTileEntry(key);
    },

    // Removes the billboards of a tile entry WITHOUT forgetting its fetch
    // record. Used by setPreferredZoom to drop the labels of tiles that fell
    // outside the zoom window: the tile must be remembered so zooming back out
    // can bring its labels back.
    _removeTileEntry: function (key) {
      var entry = this.tiles.get(key);
      if (!entry) {
        return;
      }
      var self = this;
      entry.handles.forEach(function (handle) { self.removeLabel(handle); });
      entry.keys.forEach(function (dedupKey) {
        var seen = self.seen.get(dedupKey);
        if (seen && seen.tileKey === key) {
          self.seen.delete(dedupKey);
        }
      });
      this.totalLabels -= entry.handles.length;
      this.tiles.delete(key);
    },

    // Keeps only the tiles whose key is in the given Set (used by the globes
    // that can enumerate their currently-rendered tiles each frame).
    retain: function (keys) {
      var self = this;
      this.tiles.forEach(function (entry, key) {
        if (!keys.has(key)) {
          self.removeTile(entry.z, entry.x, entry.y);
        }
      });
    },

    // Removes every billboard and forgets every tile / view. Works for BOTH
    // modes: tile mode (labels grouped under `tiles`) and view mode (labels
    // only in `seen`, grouped under tileKey 'view').
    clear: function () {
      if (this._viewAbortController) {
        this._viewAbortController.abort();
        this._viewAbortController = null;
      }
      var self = this;
      var removed = new Set();
      // Remove the billboards owned by the tile entries...
      this.tiles.forEach(function (entry) {
        entry.handles.forEach(function (handle) {
          if (!removed.has(handle)) {
            removed.add(handle);
            self.removeLabel(handle);
          }
        });
      });
      // ...and the view-mode billboards (only in `seen`).
      this.seen.forEach(function (entry) {
        if (!removed.has(entry.handle)) {
          removed.add(entry.handle);
          self.removeLabel(entry.handle);
        }
      });
      this.tiles.clear();
      this.pending.clear();
      this.seen.clear();
      this.fetched.clear();
      this.totalLabels = 0;
      this.currentView = null;
      this._viewRequestId = (this._viewRequestId || 0) + 1;
    }
  };

  // Creates a label layer bound to this provider.
  OlMapbox3DProvider.prototype.createLabelLayer = function (options) {
    return new OlMapbox3DLabelLayer(this, options);
  };

  // 3D object product (phase 3): returns georeferenced building/feature data,
  // e.g. [{ id, geometry, base, height, properties }] — NOT positioned on the
  // terrain; the globe engine does that. Only produced from objects3d.minZoom.
  OlMapbox3DProvider.prototype.getObjects3D = function (z, x, y, options) {
    throw new Error('getObjects3D is not implemented yet (objects3d phase).');
  };

  root.OlMapbox3DProvider = OlMapbox3DProvider;
  // Backwards-compatible alias for the previous name.
  root.OlMapboxTileProvider = OlMapbox3DProvider;
})(typeof globalThis === 'undefined' ? window : globalThis);
