---
slug: viewer-pack-shape-01-names
criteria:
  - id: ac-001
    summary: rslib bundled entry key is `main` with named chunk ids
    type: code
    pass_when: |
      stage/rslib.config.ts has `entry: { main: "./src/element_entry.ts" }`
      in the bundle:true lib item, and its tools.rspack adds a chunk-naming
      option alongside the existing config.optimization spread; the `1~`
      prefix, `workerChunkLoading: "import"`, asyncWebAssembly, the
      IgnorePlugin bans, and the bundle:false lib item are byte-identical
      to 75dca67 apart from comment wording.
    status: verified
    last_checked: 2026-08-16
  - id: ac-002
    summary: stage manifest points exports and sideEffects at dist/main.js
    type: code
    pass_when: |
      stage/package.json has exports["./viewer"].import and .default equal to
      "./dist/main.js", has "./dist/main.js" in sideEffects, and the string
      "dist/viewer.js" appears nowhere in the file (exports subpath key
      "./viewer" itself is unchanged).
    status: verified
    last_checked: 2026-08-16
  - id: ac-003
    summary: check:pack script carries all four tightened clauses
    type: code
    pass_when: |
      stage/package.json check:pack (a) tests `-s dist/main.js`, (c) bans both
      `viewer.js` and root-level PURELY-numeric basenames (`^[0-9]+\.js$`
      semantics; the clause must NOT fire on `1~*` chunk names, which are
      legitimately present while this ring runs) with an echoed
      offending path before `exit 1`, (d) sums `main.js` plus `1~*` basenames
      plus a `-path` pattern covering nested `1~*/` files, keeps the literal
      26214400 budget, and still ends with the success echo.
    status: verified
    last_checked: 2026-08-16
  - id: ac-004
    summary: built stage dist has main.js and no legacy or numeric chunk names
    type: runtime
    pass_when: |
      After `npm run build:stage` on a clean tree, stage/dist/main.js exists
      and is non-empty, stage/dist/viewer.js does not exist, and no file
      matching ^[0-9]+\.js$ exists at stage/dist root (dist/7642.js gone);
      stage/dist/index.js from the bundle:false item still exists.
    status: verified
    last_checked: 2026-08-16
  - id: ac-005
    summary: check:pack is green on the real built dist
    type: runtime
    pass_when: |
      `npm run check:pack` exits 0 on the freshly built stage/dist and prints
      its "check:pack ok (viewer surface <B>B / 25MB)" line, with <B> now
      including stage/dist/1~@babylonjs/serializers.js (previously unmeasured).
    status: verified
    last_checked: 2026-08-16
  - id: ac-006
    summary: regression example reproduces the locked dist shape
    type: runtime
    pass_when: |
      `node regressions/viewer-pack-shape-01-names.ts` exits 0 and prints
      "viewer-pack-shape-01-names ok" after asserting these hard-coded
      goldens against stage/dist: main.js present and non-empty; no
      viewer.js at dist root; no ^\d+\.js$ file at dist root; main.js text
      contains both "molvis-viewer" and "molvis-style-gallery". No assertion
      references 1~gltf.js, and the script imports nothing outside node:fs /
      node:path / node:url.
    status: verified
    last_checked: 2026-08-16
  - id: ac-007
    summary: pack gate proven to bite on both banned artifact names
    type: runtime
    pass_when: |
      With a decoy stage/dist/viewer.js present, `npm run check:pack` exits
      non-zero and echoes that path; with it removed and a decoy
      stage/dist/1234.js present, it again exits non-zero and echoes that
      path; with both decoys deleted it exits 0.
    status: verified
    last_checked: 2026-08-16
  - id: ac-008
    summary: docs and README name dist/main.js with a pin matching root version
    type: docs
    pass_when: |
      The string "dist/viewer.js" appears nowhere under docs/ or in
      stage/README.md; docs/assets/javascripts/molvis-elements.js line 12
      resolves "../molvis-stage/main.js", its jsDelivr fallback URL and the
      docs/interfaces/web/install.md CDN URL both end in /dist/main.js with a
      pinned version string equal to the root package.json `version` field;
      molvis-elements.js carries one comment line stating the fallback only
      resolves once that version is published and that the staged
      node_modules copy is the primary path. site/ is unmodified.
    status: pending
---

# Acceptance criteria

- **ac-001 / ac-002 / ac-003** are the static edits: build config, manifest wiring, gate text. ac-002's `sideEffects` clause is the tree-shake sentinel; ac-006's `molvis-viewer` string assertion is its runtime counterpart.
- **ac-004 / ac-005 / ac-006** run on a real `npm run build:stage` product and must tolerate ring-02 chunks (`1~gltf.js`) still being present.
- **ac-007** is the gate-bites proof — the gate is not accepted merely because it passes, it must be shown to fail on both newly banned shapes.
- **ac-008** covers the live pin decision: never invent a release number; the pin is copied from the root `package.json` `version`.
