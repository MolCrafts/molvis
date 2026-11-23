# Streaming and worker contracts

## Trajectories and mrec

- Use MolRS `*Stream` decoders for scanning, indexing, and one-frame decode.
  Worker-backed reads are the default when Workers are available; the existing
  synchronous provider is the fallback.
- `loadMrecSource` and the Record branch of `loadFileContent` share the same
  commit path. Directory stores and `.mrec.zip` are record inputs, not extra
  `FileFormat` values.
- A record can contain both a `frame` section and a `trajectory` section.
  Read sections explicitly and compose their contributions. Never guess the
  source type from the package suffix or decode the whole record for one section.
- Read a record's frame section before transferring its sequence buffers:
  `postMessage` transfer detaches the sender's buffers.
- Memory stores transfer a file map once to `MapMrecStoreHost`. File-tree
  stores retain File handles and read exact ranges synchronously inside the
  worker. Open both through `new MrecReader(host)`; packed ZIP bytes use
  `new MrecReader(bytes)`. Snapshot sections use `new MrecFile(source).frame()`.
- Keep numeric metadata, string metadata such as `local_labels`, and
  `sectionUpdates` in frame encoding. The worker can free its own decoded
  ephemeral Frame after encoding the full JS-owned payload.
- Carry `sectionUpdates` through provider → trajectory → frame classifier.
  Atom counts/occupancy and non-atom update IDs inform `changeKind`; consumers
  use that verdict instead of deriving another one from row counts.

## VS Code

- The main thread fetches the worker script and WASM. A blob worker receives
  WASM bytes by message and instantiates locally. Do not fetch/import
  vscode-cdn resources inside that worker or construct a Worker from a CDN URL.
- The async webview-host channel cannot satisfy a synchronous store callback.
  Use the existing bounded, once-transferred mrec map path; do not introduce an
  `Atomics.wait` bridge requiring unavailable cross-origin isolation.
- Quick View and Page are independent webviews with separate WASM memories.
  They cannot share parsed Frame handles. Keep host transport and engine
  ownership separate rather than pretending a handle can cross that boundary.
- The Files tree reads one directory per `getChildren`, honoring ignored
  directories and nested ignore rules. Treat an mrec directory as a leaf;
  avoid recursive workspace scans and a second tree cache.

## Column identity

LAMMPS `dump local` column names are user data. Preserve `local_labels`, use
`matchBondEndpointColumns` for confident matches, and request mapping when
ambiguous. Do not assume the first two columns are endpoints. Existing
`BondColumnRemapModifier` handles endpoint remapping without inventing atoms.
