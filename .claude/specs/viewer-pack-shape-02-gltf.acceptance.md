---
slug: viewer-pack-shape-02-gltf
criteria:
  - id: ac-001
    summary: exportGLTF and its type import are gone from stage/src/app.ts
    type: code
    pass_when: |
      grep -n "exportGLTF\|GltfExportOptions" stage/src/app.ts returns no
      matches, and stage/src/app.ts contains no import of "./export/gltf".
    status: pending
  - id: ac-002
    summary: barrel no longer re-exports the glTF exporter
    type: code
    pass_when: |
      stage/src/index.ts contains no "./export/gltf" re-export line, and a
      repo-wide grep for exportFrameToGLB — excluding node_modules,
      docs/assets, site/, and every build output directory (*/dist/**,
      vsc-ext/out*/**), which legitimately carry the symbol
      (stage/dist/export/gltf.js IS the subpath target) — matches only
      stage/src/export/gltf.ts, stage/tests/export/gltf.test.ts and
      regressions/viewer-pack-shape-02-gltf.ts.
    status: pending
  - id: ac-003
    summary: exporter source and its unit test are untouched by this ring
    type: code
    pass_when: |
      git diff 75dca67 -- stage/src/export/gltf.ts stage/tests/export/gltf.test.ts
      prints nothing.
    status: pending
  - id: ac-004
    summary: stage exposes ./export-gltf as a typed public subpath
    type: code
    pass_when: |
      stage/package.json exports["./export-gltf"] equals
      {types: "./dist/export/gltf.d.ts", import: "./dist/export/gltf.js",
      default: "./dist/export/gltf.js"}, it is declared after "./element" and
      before "./io", and dependencies still list "@babylonjs/serializers".
    status: pending
  - id: ac-005
    summary: plugin SDK lists the new host module id
    type: code
    pass_when: |
      PLUGIN_HOST_MODULE_IDS in plugin/src/externals.ts contains
      "@molcrafts/molvis-stage/export-gltf".
    status: pending
  - id: ac-006
    summary: page host joins the new id to the LAZY bucket only
    type: code
    pass_when: |
      page/src/plugins/host_shared.ts adds "@molcrafts/molvis-stage/export-gltf"
      to LazyHostModuleId, to the PluginHostModules type as
      typeof import("@molcrafts/molvis-stage/export-gltf"), and to the
      Promise.all in getPluginHostModules — with no new top-level static
      import of that specifier and no new entry in eagerPluginHostModules.
    status: pending
  - id: ac-007
    summary: new regression gate fails against the pre-deletion dist
    type: runtime
    pass_when: |
      With the source edits applied but before npm run build:stage, running
      node regressions/viewer-pack-shape-02-gltf.ts against the existing
      stage/dist (which still holds 1~gltf.js and 1~@babylonjs/serializers.js)
      exits non-zero.
    status: pending
  - id: ac-008
    summary: rebuilt viewer pack drops both glTF chunks; subpath deep import works
    type: runtime
    pass_when: |
      After npm run build:stage, node regressions/viewer-pack-shape-02-gltf.ts
      exits 0 and prints "viewer-pack-shape-02-gltf ok"; the script itself
      asserts stage/dist/1~gltf.js absent, stage/dist/1~@babylonjs/ absent,
      stage/dist/index.js text free of exportFrameToGLB, and
      import("../stage/dist/export/gltf.js") exporting exportFrameToGLB as a
      function.
    status: pending
  - id: ac-009
    summary: stage unit suite stays green, exporter test included
    type: runtime
    pass_when: |
      npm run test:stage exits 0 with stage/tests/export/gltf.test.ts
      reported as passing.
    status: pending
  - id: ac-010
    summary: full repo check passes across workspaces
    type: runtime
    pass_when: |
      biome check . && npm run typecheck exits 0 (page typecheck included,
      which is what proves the lazy-bucket satisfies-coupling holds), and
      npm run check:pack prints its "check:pack ok" line.
    status: pending
  - id: ac-011
    summary: plugin docs id list names the new subpath
    type: docs
    pass_when: |
      The pluginExternals coverage paragraph at docs/development/plugins.md
      (currently lines 155-158) lists
      "@molcrafts/molvis-stage/export-gltf" alongside the existing ids.
    status: pending
---

# Acceptance criteria

- **ac-001 / ac-002 / ac-003** — 三点删除是这一环的全部源码改动面：方法、桶导出各删一次，导出器本体与其单测必须逐字节不变（`git diff` 空）。任何为了"平滑迁移"新增的转发函数或别名都会让 ac-002 的 grep 收到多余命中而红。
- **ac-004 / ac-005 / ac-006** — 公共子路径与宿主接线的静态面。ac-006 特意把「不得出现静态 import / 不得进 eager 桶」写进条件：进 eager 桶功能上也能跑通、typecheck 也绿，但会把 serializers 重新钉回 page 启动图，正好废掉本环目的，所以由人读的条件而非编译器来把关。
- **ac-007** — 门必咬。只验证「重建后绿」无法区分「断言成立」与「断言写错了永远绿」；先在旧 dist 上看它红一次，才证明这条 lane 有牙。
- **ac-008** — 交付面的运行时判定，由 `regressions/viewer-pack-shape-02-gltf.ts` 自证：分块消失 + 子路径深引可达。golden 是写死的文件形状字面量，无第三方工具参与、无 WASM 实例化，符合 `regressions/` 契约。
- **ac-009 / ac-010** — 既有覆盖与全仓 check 不许因这次删除退化；page typecheck 是编译期互锁真正生效的证据。
- **ac-011** — 散文清单是插件作者唯一会读的 id 来源，代码加了 id 而文档没加，下一个插件作者就会漏配 externals。
