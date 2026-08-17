# Development

## Setup

``` bash
git clone https://github.com/molcrafts/molvis
cd molvis
npm install
```

## Build

The product frontend lives in `page/` and is built once. The Python package
ships that bundle as static assets under `python/src/molvis/dist/`.

``` bash
npm run build:page          # page bundle → python/src/molvis/dist/
npm run build:all           # core + page + vsc-ext
```

## Live reload during development

Two terminals:

=== "Terminal 1 — page dev server"

    ``` bash
    npm run dev:page
    ```

=== "Terminal 2 — Python pointed at the live bundle"

    ``` bash
    MOLVIS_PAGE_DIST=page/dist python test_molvis.py
    ```

The `MOLVIS_PAGE_DIST` environment variable overrides the bundled
static assets, pointing to the dev server's output for live reload.

## Testing

``` bash
npm test                         # all workspaces (core, page, vsc-ext, python)
npm run test:python              # pytest only
npm run test:core                # core rstest
```

## Packaging

``` bash
npm run build:page               # ships page bundle into python/src/molvis/dist/
cd python
python3 -m build --wheel
```

## Project structure

``` text
python/
  src/molvis/
    __init__.py            # Public API: Molvis, WebSocketTransport, Selection, …
    scene.py               # Molvis class — transport-agnostic
    events.py              # EventBus, ViewerState, Selection
    transport/
      base.py              # Transport Protocol
    transport/
      __init__.py          # Package entry
      _codec.py            # BinaryPayloadEncoder/Decoder + binary frame codec
      websocket.py         # WebSocketTransport (server + handshake + dispatch)
    commands/              # Command mixins (drawing, selection, snapshot, frame, …)
    dist/             # Built page bundle (gitignored, populated by build:page)
```
