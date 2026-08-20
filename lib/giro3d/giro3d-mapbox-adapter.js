(function (root) {
  'use strict';

  // Adapter-specific virtual URLs allow Giro3D to request XYZ coordinates normally.
  var virtualTilePattern = /ol-mapbox-provider:\/\/(\d+)\/(\d+)\/(\d+)/;

  function imageToBlob(image) {
    if (typeof image.toBlob === 'function') {
      return new Promise(function (resolve, reject) {
        image.toBlob(function (blob) {
          blob ? resolve(blob) : reject(new Error('Unable to encode the styled tile.'));
        }, 'image/png');
      });
    }
    var canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext('2d').drawImage(image, 0, 0);
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        blob ? resolve(blob) : reject(new Error('Unable to encode the styled tile.'));
      }, 'image/png');
    });
  }

  function Giro3DMapboxTileAdapter(options) {
    options = options || {};
    if (!options.provider) {
      throw new Error('Giro3DMapboxTileAdapter requires a tile provider.');
    }
    if (!root.Giro3D || !root.Giro3D.TiledImageSource) {
      throw new Error('Giro3D must be loaded before creating this adapter.');
    }
    this.provider = options.provider;
    this.instance = options.instance || null;
    this.tileBlobs = new Map();
    // Optional OlMapbox3DProvider.createLabelLayer() instance. When set, the
    // adapter drives its addTile/removeTile from Giro3D's own tile lifecycle:
    // labels appear when a tile is loaded and disappear when Giro3D drops it
    // (view change), so they always match the imagery on screen.
    this.labelLayer = options.labelLayer || null;
    // Optional source-layer (mvt:layer) filter for the TILE bitmaps, forwarded
    // to provider.getTileImage()'s `layers` option. null = draw every layer.
    // From code you can pass an array to draw N sources at once.
    this.tileLayers = options.tileLayers || null;
    // maxCachedTiles: 0 disables the PNG-blob cache entirely (every tile is
    // re-encoded on demand — more CPU, but no memory retained for re-serving
    // tiles at the same zoom; recommended on low-RAM devices).
    this.maxCachedTiles = options.maxCachedTiles === undefined ? 128 : options.maxCachedTiles;
  }

  Giro3DMapboxTileAdapter.prototype.createSource = function () {
    var adapter = this;
    var source = new root.Giro3D.TiledImageSource({
      source: adapter.provider.createXYZSource()
    });
    var defaultFetchData = source.fetchData.bind(source);

    // Translate Giro3D's tile URL request into the generic provider contract.
    source.fetchData = async function (url, signal) {
      if (signal && signal.aborted) {
        throw new DOMException('Tile request aborted.', 'AbortError');
      }
      var match = url.match(virtualTilePattern);
      if (!match) {
        return defaultFetchData(url, signal);
      }
      var z = Number(match[1]);
      var x = Number(match[2]);
      var y = Number(match[3]);
      var cacheKey = [z, x, y].join('/');
      var blobPromise = adapter.tileBlobs.get(cacheKey);
      if (!blobPromise) {
        // The AbortSignal is forwarded so that when Giro3D drops the tile
        // (the user changed view), the in-flight worker request is cancelled
        // instead of continuing to render a tile nobody needs anymore, and the
        // composed bitmap is released from the provider cache.
        blobPromise = adapter.provider.getTileImage(z, x, y, {
          caller: 'giro3d',
          signal: signal,
          // The "tiles" source-layer filter (null = draw every layer). From
          // code you can pass an array for N sources at once.
          layers: adapter.tileLayers
        }).then(function (tile) {
          // The tile imagery is ready: ask the label layer to render the
          // labels of this same tile (labels come from the same worker pass,
          // so this is nearly free).
          if (adapter.labelLayer) {
            adapter.labelLayer.addTile(z, x, y);
          }
          return imageToBlob(tile.image).finally(function () {
            if (tile.image && typeof tile.image.close === 'function') {
              tile.image.close();
            }
          });
        }).then(function (blob) {
          // Keep the encoded blob only when the cache is enabled; otherwise
          // hand it to Giro3D and forget it (re-encode on next request).
          if (adapter.maxCachedTiles > 0) {
            adapter.tileBlobs.delete(cacheKey);
            adapter.tileBlobs.set(cacheKey, Promise.resolve(blob));
            while (adapter.tileBlobs.size > adapter.maxCachedTiles) {
              adapter.tileBlobs.delete(adapter.tileBlobs.keys().next().value);
            }
          }
          return blob;
        }).catch(function (error) {
          adapter.tileBlobs.delete(cacheKey);
          // When Giro3D drops the tile (view change), tell the provider it can
          // release the composed bitmap from its cache, and tell the label
          // layer to remove this tile's billboards.
          if (signal && signal.aborted) {
            if (adapter.provider.releaseTile) {
              adapter.provider.releaseTile(z, x, y);
            }
            if (adapter.labelLayer) {
              adapter.labelLayer.removeTile(z, x, y);
            }
          }
          throw error;
        });
        adapter.tileBlobs.set(cacheKey, blobPromise);
      }
      if (signal && signal.aborted) {
        throw new DOMException('Tile request aborted.', 'AbortError');
      }
      return blobPromise;
    };

    if (adapter.instance) {
      // Giro3D is event-driven and must be notified when the custom source changes.
      source.addEventListener('change', function () {
        adapter.instance.notifyChange(source);
      });
    }
    return source;
  };

  Giro3DMapboxTileAdapter.prototype.createColorLayer = function (options) {
    options = options || {};
    options.source = this.createSource();
    return new root.Giro3D.ColorLayer(options);
  };

  root.Giro3DMapboxTileAdapter = Giro3DMapboxTileAdapter;
})(typeof globalThis === 'undefined' ? window : globalThis);
