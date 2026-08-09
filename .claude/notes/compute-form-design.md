# Compute form design — left rail

Product name: **Compute** (molrs/molpy-aligned). Was “Analysis” in chrome.

Synthesized from `mol:pm` + `mol:web-design` review (2026-08-09). Binding for
new and reworked compute panels.

## Principles

1. Scientist density (OVITO / freud), not SaaS calm.
2. Form configures *this run*, does not teach theory.
3. Defaults match the frame (box → g(r) + ρ from box; no box → p(r)).
4. ≤6 primary fields; rest under Advanced (when needed).
5. Shared anatomy: subjects → algorithm → advanced → alerts → result; run bar pinned footer.
6. Derived values = meta lines, never fake locked inputs / emoji.
7. Explicit Run; stale-aware results.
8. Units on labels; mono + tabular-nums on numbers.

## Narrow rail (~240–320px)

| Pattern | When |
|---|---|
| Full-width `ParamStack` | Selects, long values |
| `grid-cols-2` | Exactly two peer short scalars |
| `grid-cols-3` | Exactly three peer short scalars (bins · r_min · r_max, or frame scope) |
| **Never** | N-col grid with an orphan remainder (e.g. 3 fields in 2-col) |

**Auto fields:** placeholder `Auto` or `0` only. Estimates go in `ParamStack`
`caption` under the control (or run-bar summary), never in long placeholders.

**Derived:** one muted line, e.g. `ρ from box · V = 1.23×10⁴ Å³`.

**Empty states:** title only (`No RDF yet`, `No MSD yet`). No tutorial
paragraphs.

**ParamStack API:** `label` + optional `unit` + optional `caption`.

## IA (any compute)

0. Catalog picker (shell)  
1. Scope (frames; hide atom scope if panel owns groups)  
2. Subjects (Group A/B, selection, mask)  
3. Algorithm primary  
4. Advanced (collapsed; auto-open only if required value missing)  
5. Alerts (only when true)  
6. Result (after first run)  
7. Footer run bar  

## RDF (applied baseline)

Primary: Group A · Group B · Representation · bins | r_min | r_max (3-col).  
Box + g(r): caption `ρ from box · V = …` — not an editable field.  
No box + forced g(r): reference volume source + value.  
Empty: `No RDF yet`.

## Anti-patterns (ban)

- Orphan grid cells  
- Long Auto placeholders that overflow mono inputs  
- Fake locked density chips with emoji  
- Tutorial empty states  
- Schema dump with equal weight on every param  
- Dual full algorithm forms on left *and* right (left compute / right draw)

## Rename status

| Layer | Status |
|---|---|
| User-facing “Analysis” → “Compute” | Done (tab, aria, status, shell mode) |
| Layout ids `analysis` → `compute` | Done (viewer-layout, App panel id) |
| `LeftShellMode` / APIs | Done (`setComputeMode`, `closeLeftToCompute`) |
| Component/module names `Analysis*` | Deferred (internal; not user-visible) |
| stage `analysis/*`, events `analysis-*` | Deferred (API surface) |
| Plugin `analysis.register` | Deferred (public plugin API) |

## Acceptance (new compute form)

- [ ] Subjects → primary → advanced → result; footer run bar  
- [ ] No wrap / overflow at 240px  
- [ ] No orphan grid cells  
- [ ] Auto = short placeholder + caption estimate  
- [ ] Derived = meta line  
- [ ] Empty = title only; product says **Compute**  
- [ ] Units on labels; mono tabular-nums  
