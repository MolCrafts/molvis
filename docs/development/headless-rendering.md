# Headless rendering harness

The headless harness renders the real Babylon.js WebGL2 shaders in Chromium.
It is used for visual regression checks of molecular representations, outlines,
and volumetric surface styles without mounting the three-panel application UI.

## Run the smoke suite

From the repository root:

```bash
npm run test:headless
```

This builds `core/examples/headless_render.ts`, launches Chromium through
Playwright, renders every scene in `core/examples/headless_smoke.json`, and
writes PNGs to `core/examples-dist/headless-smoke/`. The command fails on an
invalid suite, duplicate or unsafe scene name, browser exception/error log,
non-PNG result, or empty capture.

The committed suite covers all ten molecular representations, outline on/off,
outline contrast on a dark background, all four surface shader styles, cloud,
and combined surface-plus-cloud rendering.

## Suite format

A suite is an object with shared `defaults` and a non-empty `scenes` array.
Each scene contains a filesystem-safe name and a partial scene spec. `style`,
`grid`, `grid.style`, and `camera` are merged with their defaults; other fields
replace the default value.

```json
{
  "defaults": {
    "atoms": {
      "x": [0, 1.2],
      "y": [0, 0],
      "z": [0, 0],
      "element": ["C", "O"]
    },
    "bonds": { "i": [0], "j": [1] },
    "background": "#F4F6F8",
    "transparent": false,
    "width": 900,
    "height": 600
  },
  "scenes": [
    {
      "name": "flat-outlined",
      "spec": {
        "style": { "representation": "flat", "outline": true }
      }
    },
    {
      "name": "spacefill",
      "spec": {
        "style": { "representation": "spacefill" }
      }
    }
  ]
}
```

`spec.style` is deliberately a single global molecular style block:

| Field | Type | Meaning |
|---|---|---|
| `representation` | representation ID | Active preset for all atoms and bonds |
| `outline` | boolean | Heavy outline for `flat`, `skeletal`, or `graph` |
| `atomRadiusScale` | positive number | Global atom-radius multiplier |
| `bondRadiusScale` | positive number | Global bond-radius multiplier |

There are no representation or outline fields on atoms, bonds, or draw calls.
Per-atom test colors belong in `colorRanges`, because those are input data
overrides rather than a second visual style.

Volumetric rendering is configured under `grid.style` using fields from
`IsosurfaceStyle`:

```json
{
  "name": "contour-and-cloud",
  "spec": {
    "grid": {
      "shape": [18, 18, 18],
      "boxLength": 14,
      "style": {
        "renderMode": "both",
        "surfaceStyle": "contour",
        "contourSpacing": 0.45,
        "cloudThreshold": 0.12,
        "cloudStride": 2
      }
    }
  }
}
```

To run another suite or choose a different output directory:

```bash
cd core
npm run build:headless
node scripts/headless_render_runner.mjs \
  --dist examples-dist/headless \
  --specs /absolute/path/to/scenes.json \
  --outdir /tmp/molvis-renders
```

Add `--verbose true` to include the browser's complete Babylon.js/WebGL log.
By default the runner prints scene progress plus browser warnings and errors.
Each scene receives its own browser page and WebGL context, which prevents a
large style matrix from exhausting Chromium's active-context limit.
