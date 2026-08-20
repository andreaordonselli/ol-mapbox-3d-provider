# ol-mapbox-3d-provider

Render a Mapbox/MapLibre style on 3D globes — **Giro3D**, **Cesium** and
**OpenGlobus** — with one shared, worker-based pipeline.

<img width="1366" height="632" alt="image" src="https://github.com/user-attachments/assets/2fb3c3ba-4402-41d7-b652-e701b40eec2b" />


`OlMapbox3DProvider` turns a Mapbox style (vector tiles + style JSON) into
ready-to-use products for globe libraries:

- **Tile bitmaps** — one composed `ImageBitmap` per `z/x/y`, styled with
  `ol-mapbox-style` in a Web Worker.
- **Label sets** — already decluttered, priority-ordered billboard data, for
  either one tile (`getLabels`) or a whole camera view (`getLabelsForView`).
- **3D objects** — georeferenced feature data (phase 3, planned).

The globe engines never see OpenLayers. They receive raster images and plain
label objects; turning those into textures, billboards or meshes is the
globe's job.

## Highlights

- **One style, three globes.** The style is parsed and applied once, then every
  globe reuses the same composed tiles and label sets.
- **Workers do the heavy lifting.** Tile composition and whole-view label
  rendering run in separate worker pools, so a slow label render never blocks
  tile delivery.
- **Automatic device tuning.** A three-tier capability profile
  (`aggressive` / `balanced` / `constrained`) is derived from hardware signals
  (cores, RAM, pixel ratio, OffscreenCanvas) — no user-agent sniffing.
- **View-based labels.** Labels are computed over the whole visible extent with
  a single declutter pass, exactly like the 2D map, then diffed against the
  current billboards (no flicker on camera move).
- **3D terrain + label draping.** Activate terrain per engine and labels are
  re-positioned at the terrain height below them, plus a depth bias to keep
  them readable.

## Architecture

```
                        OlMapbox3DProvider (main entry)
                                 │
          ┌──────────────────────┼───────────────────────┐
          │                      │                       │
   tile workers            label workers            label layer
   (compose bitmaps)     (whole-view declutter)    (billboard diff)
          │                      │                       │
          └──────────┬───────────┴───────────┬───────────┘
                     │                       │
              OlMapbox3DGlobe         per-engine adapters
              (shared dispatcher)     (Giro3D / Cesium /
                     │                 OpenGlobus)
                     ▼
                 your app
```

- `OlMapbox3DProvider` — the pipeline: workers, caches, concurrency limit,
  device profile, and the tile/label product APIs.
- `OlMapbox3DGlobe` — a thin engine-agnostic dispatcher with one uniform
  `create` / `activateTerrain` / `deactivateTerrain` contract.
- The **per-engine adapters** implement that contract for each globe library.

## File structure

full demo: ol 2d + the three globes side by side

https://andreaordonselli.github.io/ol-mapbox-3d-provider/index.html

minimal Giro3D example

https://andreaordonselli.github.io/ol-mapbox-3d-provider/giro3d.html

minimal Cesium example

https://andreaordonselli.github.io/ol-mapbox-3d-provider/cesium.html

minimal OpenGlobus example

https://andreaordonselli.github.io/ol-mapbox-3d-provider/openglobus.html

Giro3D example with tiles/labels filter combos

https://andreaordonselli.github.io/ol-mapbox-3d-provider/giro3d_custom.html

Cesium example with tiles/labels filter combos

https://andreaordonselli.github.io/ol-mapbox-3d-provider/cesium_custom.html

OpenGlobus example with tiles/labels filter combos

https://andreaordonselli.github.io/ol-mapbox-3d-provider/openglobus_custom.html

```
lib/
  ol-mapbox-3d-provider.js     main entry — OlMapbox3DProvider
  ol-mapbox-globes.js          shared globe core — OlMapbox3DGlobe
  ol-mapbox-tile-worker.js     tile-composition worker
  ol-mapbox-label-worker.js    whole-view label worker
  ol-mapbox-additional-code-giro3d.js      Giro3D adapter (for its maintainers)
  ol-mapbox-additional-code-cesium.js      Cesium adapter (for its maintainers)
  ol-mapbox-additional-code-openglobus.js  OpenGlobus adapter (for its maintainers)

  ol/              vendored OpenLayers
  ol-mapbox-style/ vendored ol-mapbox-style
  giro3d/          vendored Giro3D + tile adapter
  cesium/          vendored Cesium + ol-cesium
  openglobus/      vendored OpenGlobus (loaded lazily)
```

> The main module is named `ol-mapbox-3d-provider.js` to match the
> `OlMapbox3DProvider` class it defines.

## Quick start

### Run the examples

Serve the repository root with any static server and open an example:

```bash
python3 -m http.server 8000
# http://localhost:8000/giro3d.html
# http://localhost:8000/cesium.html
# http://localhost:8000/openglobus.html
```

The full demo (all globes + the 2D reference map) is `index.html`.

Each example uses the public [OpenFreeMap](https://openfreemap.org/) Liberty
style (`https://tiles.openfreemap.org/styles/liberty`) and loads the globe
libraries from the vendored files in `lib/`.

### Use the API

```js
const provider = new OlMapbox3DProvider({
  style: 'https://tiles.openfreemap.org/styles/liberty',
  workerUrl: 'lib/ol-mapbox-tile-worker.js',
  labelWorkerUrl: 'lib/ol-mapbox-label-worker.js'
});

// Raster product
const tile = await provider.getTileImage(z, x, y, { caller: 'giro3d' });

// Label products
const tileLabels = await provider.getLabels(z, x, y);
const viewLabels = await provider.getLabelsForView([west, south, east, north], zoom, {
  resolution: canvasWidth
});
```

The globe integration is a single uniform call:

```js
const options = {
  target: 'globe',             // element id (or element)
  provider: provider,          // one shared provider
  initialView: [7.3203, 45.7378] // [lon, lat]
};

OlMapbox3DGlobe.create('giro3d', options)
  .then(state => OlMapbox3DGlobe.activateTerrain('giro3d', state, options))
  .then(state => OlMapbox3DGlobe.deactivateTerrain('giro3d', state, options));
```

`options.deviceProfile` is optional — when omitted it is derived automatically
from `OlMapbox3DProvider.getDeviceProfile()`.

## API

### `OlMapbox3DProvider`

```js
new OlMapbox3DProvider({
  style,            // style URL (string) or style object — required
  workerUrl,        // URL of ol-mapbox-tile-worker.js — required for tiles
  labelWorkerUrl,   // URL of ol-mapbox-label-worker.js — required for view labels
  resolution,       // composed tile size in px (default: device profile)
  workerCount,      // tile worker pool size (default: device profile)
  labelWorkerCount, // label worker pool size (default: device profile)
  maxConcurrency,   // in-flight tile compositions (default: device profile)
  maxCachedTiles,   // composed-tile LRU size (default: device profile)
  layers,           // source-layer filter for tiles (null = all)
  labelLayers,      // source-layer filter for labels (null = all)
  log, workerLog, workerTimeout
});
```

Products and helpers:

- `getTileImage(z, x, y, options)` → `Promise<{ image, labels, z, x, y, extent, projection }>`
- `getLabels(z, x, y, options)` → `Promise<label[]>`
- `getLabelsForView(extent, zoom, options)` → `Promise<label[]>`
- `getTile(z, x, y, { products })` → `Promise<{ bitmap, labels, objects3d }>`
- `createLabelLayer(options)` → `OlMapbox3DLabelLayer`
- `createXYZSource()` → an `ol.source.XYZ` for `z/x/y`-based globes
- `setLabelBake(layers, enabled)` — control which line labels are baked into the tiles
- `invalidate()` — drop every cached/in-flight tile and label render
- `OlMapbox3DProvider.getDeviceProfile()` — static access to the auto-tuned profile

Every `getTileImage` / `getLabelsForView` call accepts an optional
`AbortSignal`; aborting cancels the worker request (typically because the user
changed the view).

### `OlMapbox3DGlobe`

```js
OlMapbox3DGlobe.register(engine, impl);
OlMapbox3DGlobe.create(engine, options)                 // -> Promise<state>
OlMapbox3DGlobe.activateTerrain(engine, state, options) // -> Promise<state>
OlMapbox3DGlobe.deactivateTerrain(engine, state, options) // -> Promise<state>
```

The returned `state` exposes, uniformly across engines:

- `labelLayer` — billboards bound to the provider's label set
- `refreshLabels()` — re-fetch the visible label set immediately
- `setTileFilter(layers)` — re-compose the tile imagery with a new filter

## Device auto-tuning

`OlMapbox3DProvider` reads hardware signals on construction and picks a tier:

| Tier        | Tile size | Tile workers | Label workers | Concurrency | Target        |
|-------------|-----------|--------------|---------------|-------------|----------------|
| aggressive  | 512 px    | 2            | 2             | 4           | powerful desktop |
| balanced    | 256 px    | 2            | 1             | 3           | laptop / tablet |
| constrained | 256 px    | 1            | 1             | 1           | phone / low RAM |

Each tier also tunes the pixel-ratio cap, antialiasing, the decoded-tile cache
and the composed-tile LRU. The chosen profile is logged to the console on
construction, so no page code needs to call `getDeviceProfile()` manually.

## Engine adapters (for globe library maintainers)

The engine-specific code is deliberately split into three standalone files so
each library maintainer can review exactly the work done for their globe:

- `lib/ol-mapbox-additional-code-giro3d.js`
- `lib/ol-mapbox-additional-code-cesium.js`
- `lib/ol-mapbox-additional-code-openglobus.js`

Each file has a header comment with the prerequisites, the exact
`create` / `activateTerrain` / `deactivateTerrain` contract, and a minimal
usage example. It registers itself into the shared core with
`OlMapbox3DGlobe.register(...)` and contains only that engine's code.

## GitHub Pages

You can publish the site from the **root of the repository** — no need to move
the examples into a subfolder:

1. In the repository, go to **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Select your default branch and the **`/ (root)`** folder.

All paths in the examples are relative (`lib/...`), so the site works both at
the repository root on Pages and under any local static server.

## Notes and limitations

- The examples fetch tiles and styles from the public OpenFreeMap and Re:Earth
  services. Those services may change their URLs or availability; swap the
  style/terrain URLs in the examples for your own sources if needed.
- The terrain elevation for Giro3D/Cesium comes from Re:Earth; OpenGlobus uses
  its bundled `GlobusRgbTerrain`.
- `getObjects3D` is reserved for phase 3 and currently throws `not implemented`.
- The vendored libraries under `lib/` keep their own licenses.
