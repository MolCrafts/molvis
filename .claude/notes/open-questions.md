# Open Questions

Uncertainties to resolve over time; delete entries when settled.

## PBC / coordinate-frame (2026-03)

### Product model (settled)

- `matches` = **auto-attach default visual layers under the file loader**,
  default on; user unchecks. Particles / Ribbon / Simulation cell / Bonds
  (if present) / Create isosurface (grid files).
- Analysis / opt-in viz: `matches() === false`, `isApplicable` for Add menu.
  Never auto-attach Steinhardt / Solid-liquid (they overwrite CPK) or
  density surfaces by default.

### Density vs atoms wrap (fixed for Gaussian density surface)

Root cause was **not** Wrap PBC being half-applied. freud-style
`GaussianDensity` always deposits on **simbox voxels** with **PBC
wrap_index**. mmCIF ASU atoms sit outside [0,L); contributions fold into
the primary cell; Particles still draw deposited Cartn → surface in box,
protein outside.

**Fix:** Gaussian density surface (and Construct surface mesh) use
**atom AABB + pad, pbc=false** as the density domain, same world coords
as Particles. Crystal `frame.box` remains Simulation cell only.

### Coordinate policy (shipped 2026-08-11)

System-level policy on `ModifierPipeline` after compose:
`as-deposited` (default) | `wrap-atoms` | `wrap-molecules` | `unwrap-trajectory`.
Settings → Coordinates. WrapPBC / Unwrap modifiers still work and share pure
helpers under `stage/src/coords/`.

### Remaining debt

1. Ribbon MI chain-splits vs wrap (should only see post-policy coords; audit
   residual ad-hoc wrap if any)
2. Bond MI at draw time (same — prefer post-policy frame)
3. Volumetric files (CHGCAR/CUBE) still use file box + periodic MC when
   the grid is natively cell-aligned (correct for those formats; policy
   does not rewrite grids)
