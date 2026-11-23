---
name: molvis-architecture
description: Place code and maintain package boundaries in the MolVis monorepo. Use when adding public APIs, moving modules, changing dependencies or exports, integrating engines into hosts, or changing build configuration.
---

# MolVis package architecture

1. Locate the existing owner and search its public API before introducing a
   symbol or dependency. Read [package boundaries](references/package-boundaries.md)
   for the package graph and export contracts.
2. Put molecular algorithms in MolRS, shared framework-free primitives in core,
   engine behavior in Stage or Sketch, and product orchestration in a host.
   Keep domain behavior out of React panels and transport adapters.
3. Prefer a method on the owning domain type. Expose one operation at a time;
   let callers compose. Extract only for a real second caller or a meaningful
   independently testable responsibility.
4. Check import direction and published exports. A host must resolve a package
   through its exports, not a sibling engine's `src/` directory. Keep engine
   code React-free and Stage/Sketch independent.
5. Keep command semantics in the engine. GUI, RPC, custom elements, and Python
   should invoke the same behavior rather than reconstruct it independently.
   Carry public changes through the existing RPC catalog and Python command
   surface when those surfaces expose the operation.
6. Let Wireit own workspace build/watch ordering. Change the owning package's
   configuration rather than adding shell build warmups or utility scripts.
7. Use [molvis-validation](../molvis-validation/SKILL.md) to select checks for
   the affected packages. Update current API documentation for public changes.
