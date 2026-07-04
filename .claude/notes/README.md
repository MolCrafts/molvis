# `.claude/notes/` — passive project knowledge

Internal agent context that **outlives any single feature**: decisions,
architecture, contracts, open questions. Not public documentation (that is
`docs/`), not active work (that is `.claude/specs/`).

| File | Holds |
|------|-------|
| `notes.md` | Evolving decisions and captured invariants. `/mol:note` appends here. |
| `architecture.md` | Project blueprint — modules, public surfaces, layer roles. Populated by `/mol:map`, consumed by the `librarian` agent during `/mol:spec`. |
| `open-questions.md` | Uncertainties recorded during bootstrap; fill in over time. |

Add `contracts/`, `rubrics/`, `decisions/`, `debt/`, `handoffs/` subdirectories
only when there is real content for them — empty directories are not value.
