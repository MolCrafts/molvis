---
slug: one-viewer-surface-01-chrome-state
criteria:
  - id: ac-001
    summary: App has exactly one MolvisWrapper mount site
    type: code
    pass_when: |
      page/src/App.tsx contains no early return for `canvasOnly` and exactly one
      render site of the canvas (`canvas ?? <MolvisWrapper …>`); the former block
      at App.tsx:465-497 is gone.
    status: pending
  - id: ac-002
    summary: Surface flip keeps the canvas node mounted
    type: runtime
    pass_when: |
      page/tests/App.test.tsx mounts App with a `canvas` probe under
      surface:"canvas", captures the probe DOM node, patches the store to
      surface:"full", and asserts the captured node is identical (===) and still
      isConnected, while the toolbar is now present. Presence alone does not
      satisfy this criterion — it must assert node identity.
    status: pending
  - id: ac-003
    summary: Canvas surface renders no chrome region, and the bottom panel is unmounted
    type: runtime
    pass_when: |
      Under surface:"canvas" in page/tests/App.test.tsx: toolbar, both
      ViewerSidePanels and the WeChat banner are absent, and "?" does not open
      KeyboardShortcutsDialog. Separately, page/src/App.tsx guards
      WorkbenchBottomPanel by mount (`{!canvasOnly && <WorkbenchBottomPanel …>}`),
      not by a `hidden` prop — a hidden-but-mounted panel still subscribes to the
      plugin contribution store, which the DOM assertions cannot see.
    status: pending
  - id: ac-004
    summary: MountOptsStore members survive detached invocation and hand out a stable snapshot
    type: code
    pass_when: |
      page/tests/lib/mount-opts-store.test.ts destructures `get` and `subscribe`
      off the instance, calls them unbound without TypeError, and asserts two
      consecutive get() calls return the same reference when nothing changed.
    status: pending
  - id: ac-005
    summary: Closed store ignores later patches; dispose unmounts before closing
    type: code
    pass_when: |
      After store.close(), patch({surface:"full"}) notifies no listener and get()
      still returns the last snapshot; page/src/lib/mount.tsx dispose() calls
      root.unmount() before store.close().
    status: pending
  - id: ac-006
    summary: MountOptsRoot carries no policy
    type: code
    pass_when: |
      page/src/lib/MountOptsRoot.tsx contains no useMemo and no default callback;
      the onSurfaceChange fallback is composed only in mountMolvisApp
      (page/src/lib/mount.tsx); a consumer under MountOptsRoot re-renders when
      store.patch runs.
    status: pending
  - id: ac-007
    summary: MountOpts stays JSON-derivable
    type: code
    pass_when: |
      page/src/lib/mount-opts.ts is unmodified by this link (no onSurfaceChange
      on MountOpts); onSurfaceChange is declared on MountHostOpts in
      page/src/lib/mount.tsx; page/tests/mount-opts.test.ts is unchanged and green.
    status: pending
  - id: ac-008
    summary: Host-supplied onSurfaceChange takes ownership; no dead button without one
    type: runtime
    pass_when: |
      page/tests/App.test.tsx asserts: with a host onSurfaceChange, clicking
      "Show controls" calls it exactly once with "full" while store.get().surface
      stays "canvas"; without one, the "Show controls" action is not rendered at all.
    status: pending
  - id: ac-009
    summary: One overlay-action component serves both call sites
    type: code
    pass_when: |
      page/src/components/viewer/ExitFullscreenAction.tsx is deleted and no
      reference to `ExitFullscreenAction` remains under page/src;
      CanvasOverlayAction.tsx exists with props {icon,label,onClick} and no
      `corner` prop, and is used both for "Exit fullscreen" and for the
      canvas-surface "Show controls" affordance.
    status: pending
  - id: ac-010
    summary: Canvas sizing is verified live, not in the unit harness
    type: runtime
    pass_when: |
      WITHDRAWN as a unit criterion, measured and recorded: the page unit harness
      loads no stylesheet, so every Tailwind class is inert. In an 800x600 host
      the shell `section` measures 19px (intrinsic content) and the whole canvas
      chain measures 0 whether the tree is right or wrong — an assertion here
      cannot bite either way, which the "every gate must be proven to bite" rule
      forbids. Canvas sizing under surface:"canvas" is instead verified in the
      live VS Code check that carries link 02's ac-012, and must be named there.
    status: withdrawn
  - id: ac-011
    summary: Both routed debts are durable artifacts, not prose
    type: docs
    pass_when: |
      The delivery summary names the literal strings `page/src/MolvisWrapper.tsx:544`
      (init double-apply + asymmetric origin guard, routed to slug
      page-host-init-single-path) and `package-architecture.md:78-86` (regressions
      lane dist-vs-src contradiction against regressions/traj-ingest-04-range.ts:9-10,
      routed to /mol:note), and each route exists on disk as a spec file or note
      entry — a suggested slug in prose does not discharge this.
    status: pending
  - id: ac-012
    summary: Page suite green with no new red
    type: runtime
    pass_when: |
      `npm run test:page` passes with zero failures (baseline 5f4421d is 214/214)
      and all pre-commit hooks pass.
    status: pending
---

# Acceptance criteria

- **ac-002** 是本环存在的理由，也是唯一在双 `MolvisWrapper` 复活时会咬人的检查。必须断言节点**同一性**，不是存在性。
- **ac-003** 有两半：DOM 不可见，以及底部面板**不挂载**。后者是单独一条，因为前者对它结构性失明。
- **ac-004 / ac-005** 是设计评审中发现的 store 两个失效模式：未绑定的 `this`、拆卸后向死树广播。
- **ac-007** 保护 `readMountOptsFromUrl` / `readMountOptsFromHost` 的全函数性。
- **ac-008** 覆盖宿主拥有真值的那一半——link 03 证明写回，本环证明意图被送达且本包不自行翻转。
- **ac-010** 统一渲染树改变了画布的祖先链，除此之外没有任何断言看着它还能撑开高度。
- **ac-011** 铁律第 3 条：路由必须落成磁盘上的东西。
- 无 `regressions/` 条款：`page/` 是私有宿主、无发布面，本环单包，源码文本断言不是闸。
