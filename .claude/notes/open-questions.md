# Open Questions

Recorded during the `/mol:bootstrap` rebuild. Resolve over time; delete when settled.

- **`language: typescript` vs `mixed`.** TS/TSX dominate (≈421 files) over Python
  (≈41), so the frontmatter picks `typescript` and the canonical `check` is
  `biome check . && tsc`. If Python work in `python/` grows, switch to `mixed`
  and scope the per-language checks.
- **`science.required: false`.** MolVis is treated as a rendering/UI/host-integration
  project; scientific correctness of format readers and geometry lives in the
  molrs/molpy layer. Flip to `true` if you want `/mol:litrev` + the `scientist`
  agent gated onto `/mol:impl` for domain-correctness features.
- **`doc.style: jsdoc-tiered`.** Matches the prior Full/Brief/Inline docstring
  convention. Revisit if the documentation standard changes.
- **No project-specific skills/agents.** The bespoke `molvis-*` skills/agents were
  removed; the repo now relies on the generic `mol:*` plugin. Re-add a custom
  skill or agent only when a real, repeated need emerges that the plugin can't
  serve.
- **`architecture.md` is a stub.** Run `/mol:map` to regenerate the blueprint the
  old harness held (layer separation, WASM API, rendering internals).
