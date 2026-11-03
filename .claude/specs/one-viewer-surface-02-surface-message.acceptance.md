---
slug: one-viewer-surface-02-surface-message
criteria:
  - id: ac-001
    summary: Preconditions verified before implementation
    type: code
    pass_when: |
      page/src/lib/mount.tsx exposes MountedApp.setOpts(patch) (landed by link 01)
      and .claude/specs/ contains a page-host-init-single-path spec file. If either
      is absent, implementation stopped and the finding was reported rather than
      worked around.
    status: pending
  - id: ac-002
    summary: PageSurface declared host-safe in protocol, with a discoverable lock
    type: code
    pass_when: |
      vsc-ext/src/protocol/messages.ts exports PAGE_SURFACES and PageSurface
      (derived from it), carries an @see back-reference to
      attachPageHost.ts `_SurfaceLockstep` at the declaration, adds an optional
      surface?: PageSurface to the init member, and still imports nothing from
      stage/ or page/; vsc-ext/src/protocol/index.ts re-exports the new symbols.
    status: pending
  - id: ac-003
    summary: No second allow-list is introduced
    type: code
    pass_when: |
      No PAGE_HOST_MESSAGE_TYPES or isPageHostMessage exists;
      vsc-ext/src/webview/attachPageHost.ts does not pass isHostMessage; the
      existing verbatim QUICK_VIEW_HOST_MESSAGE_TYPES assertion in
      vsc-ext/tests/unit/protocol/messages.test.ts is unchanged and green, and a
      test pins that isQuickViewHostMessage still accepts
      {type:"init",surface:"canvas"} — the premise that no wider set is needed.
    status: pending
  - id: ac-004
    summary: hostSurfaceOf decodes only init, and validates the value
    type: code
    pass_when: |
      `npm run test:vsc-ext` passes with cases asserting
      hostSurfaceOf({type:"init",surface:"canvas"}) === "canvas",
      ({type:"init",surface:"full"}) === "full", and null for {type:"init"},
      {type:"init",surface:"compact"} and {type:"applySettings",surface:"canvas"}.
    status: pending
  - id: ac-005
    summary: onMessageSeen is a non-claiming pre-dispatch observer
    type: code
    pass_when: |
      In vsc-ext/src/webview/attachStageHost.ts, onMessageSeen is typed
      (message: HostToWebviewMessage) => void and invoked as the first statement
      of handleMessage, before handleCore; handleCore's body is unchanged apart
      from the added init.surface field type.
    status: pending
  - id: ac-006
    summary: Quick look cannot pass the observer seam
    type: code
    pass_when: |
      AttachQuickViewHostOptions in vsc-ext/src/webview/attachQuickViewHost.ts
      omits "onMessageSeen" alongside "isHostMessage"/"onExtraMessage", and no
      call site other than attachPageHost.ts passes onMessageSeen. This is the
      structural proof that Quick look is unaffected, not a verbal assurance.
    status: pending
  - id: ac-007
    summary: PageSurface / MolvisSurface lockstep fails typecheck on drift
    type: code
    pass_when: |
      vsc-ext/src/webview/attachPageHost.ts declares _SurfaceLockstep as
      AssertEq<PageSurface, MolvisSurface>; `npm run typecheck:vsc-ext` is green
      as shipped and turns red when a member is added to one union only —
      verified once during implementation by a throwaway edit, then reverted.
    status: pending
  - id: ac-008
    summary: attachPageHost delegates delivery, never opening a second listener
    type: code
    pass_when: |
      vsc-ext/src/webview/attachPageHost.ts contains no window.addEventListener
      and no listenWindow option, and returns attachStageHost(app, …) with an
      onMessageSeen that calls hostSurfaceOf.
    status: pending
  - id: ac-009
    summary: init.surface has a real producer and no dead wire members are added
    type: code
    pass_when: |
      vsc-ext/src/extension/panels/pagePanel.ts `case "ready"` calls
      createInitMessage("full"); the four other createInitMessage call sites are
      unchanged; no "surfaceChanged" member exists in either message union and no
      onSurfaceChange postMessage wiring exists in vsc-ext/src/page/bootstrap.tsx.
    status: pending
  - id: ac-010
    summary: bootstrap applies the host surface through link 01's seam
    type: code
    pass_when: |
      vsc-ext/src/page/bootstrap.tsx keeps mountMolvisApp's MountedApp, calls
      attachPageHost (and no longer attachStageHost directly), maps onSurface to
      setOpts({ surface }), and still passes enableDrop: false and onBusy.
    status: pending
  - id: ac-011
    summary: Webview asset revision bumped for the changed page bundle
    type: code
    pass_when: |
      WEBVIEW_ASSET_REV in vsc-ext/src/extension/panels/html.ts no longer reads
      "cmd-attrib-18"; buildCsp is unchanged; the existing revision-mechanism
      assertions in binaryEditorRange.test.ts still pass.
    status: pending
  - id: ac-012
    summary: Live page panel applies the host surface once; Quick look unchanged
    type: runtime
    pass_when: |
      In a VS Code window running the built extension: opening the MolVis page
      panel applies the host-declared surface exactly once (forcing "canvas" in
      pagePanel hides chrome with no visible full-chrome frame first), the
      developer console reports no error, and Quick look still loads a file,
      applies settings and saves as before.
    status: pending
  - id: ac-013
    summary: Both iron-law findings named and routed, not silently carried
    type: docs
    pass_when: |
      The delivery summary names page/src/MolvisWrapper.tsx:544-577 vs
      attachStageHost.ts:147-160 (init double-apply, routed to
      page-host-init-single-path, which exists on disk) and
      package-architecture.md:81-83 vs regressions/traj-ingest-04-range.ts:9-10
      (dist-vs-src contradiction, routed to /mol:note), and no regressions/
      script was added by this link.
    status: pending
---

# Acceptance criteria

- **ac-001** 前置闸。init 双路径未立 spec 就实现，等于在已知腐化上落新功能。
- **ac-003** 守的是本环最重要的一次**删减**：`"init"` 已在 Quick look 允许表内，所以第二张表是纯别名。这条同时钉住那个前提——若 Quick look 表被改窄，本条会红。
- **ac-004** 本环唯一能在 node 环境真正执行的行为。
- **ac-005 / ac-006** 单一送达所有者。观察缝返回 `void` 且 Quick look 在类型层面无法传入，是结构性证明。
- **ac-007** 结构性再声明的补偿闸：`FileFormat` / `LoadMode` 至今无此保护，新符号不再继承该缺口。
- **ac-009** 反死面：本环不预埋 `surfaceChanged`。
- **ac-011** 缓存失效；否则新宿主对旧 bundle 说话，症状是静默无效。
- **ac-012** 唯一的运行时闸（本环无法在 node 环境执行 webview 代码）。
- **ac-013** 铁律第 3 条：发现即点名，且路由必须落成磁盘上的东西。
