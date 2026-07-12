# Embed MolVis in Markdown

MolVis includes a browser-native `<molvis-viewer>` element for interactive
structures inside documentation and other HTML pages. The structure still
enters MolVis through the normal file loader and modifier pipeline; the element
only provides declarative mounting and lifecycle management.

## Load the element

`<molvis-viewer>` is a custom element, so the browser has to be told what it is
before it will render. Load the `elements` bundle once per page — importing it
registers the element as a side effect:

```html
<script
  type="module"
  src="https://cdn.jsdelivr.net/npm/@molcrafts/molvis-core@latest/dist/elements.js"
></script>
```

Pin a version (`@0.0.11` instead of `@latest`) if you need the embed to stay
byte-stable. `type="module"` is required — the bundle is ESM.

Bundler users can import it instead, which is the same registration:

```js
import "@molcrafts/molvis-core/elements";
```

Importing `@molcrafts/molvis-core` itself never registers anything, so a project
that only wants the API does not pay for the element.

This docs site already loads the bundle (see `extra_javascript` in
`zensical.toml`), so the examples below are live here.

## Markdown fence

Zensical authors can place molecular file content directly in a `molvis` fence.
The `format` option is required so the build never has to guess how to parse the
content.

```molvis {format="xyz" controls="view trajectory"}
3
water
O  0.0000  0.0000  0.0000
H  0.9572  0.0000  0.0000
H -0.2390  0.9266  0.0000
```

The fence is build-time sugar. It emits the same `<molvis-viewer>` used by raw
HTML; rendering and interaction happen in the browser.

## Raw element

Use a hidden template for inline molecular text. This keeps multiline content
out of attributes and lets MolVis read it without displaying it as page text.

```html
<molvis-viewer format="xyz" representation="ball-and-stick">
  <template data-molvis-source>
3
water
O  0.0000  0.0000  0.0000
H  0.9572  0.0000  0.0000
H -0.2390  0.9266  0.0000
  </template>
</molvis-viewer>
```

Remote files use `src`. The remote server must permit cross-origin browser
requests; add `format` when the URL has no recognizable filename extension.

```html
<molvis-viewer src="https://files.rcsb.org/download/1TQN.pdb"></molvis-viewer>
```

## Controls and modes

The default controls are `view trajectory`: the representation View panel is
visible, while the trajectory control appears only for multi-frame input. Other
control tokens are `mode`, `info`, `performance`, and `context-menu`.

For safety, document embeds permit only View mode by default. Opt into other
modes explicitly:

```html
<molvis-viewer
  src="structure.pdb"
  modes="view select edit measure"
  mode="view"
  controls="view trajectory mode context-menu"
></molvis-viewer>
```

The existing shortcuts switch enabled modes: `1` View, `2` Select, `3` Edit,
`4` Manipulate, and `5` Measure. The `mode` control is an indicator rather than
a mode picker.

The element defaults to `width: 100%` and `height: 420px`. Override those with
CSS or the `width` and `height` attributes. JavaScript integrations can inspect
`element.app`, call `element.reload()`, and listen for `molvis:ready` or
`molvis:error`.
