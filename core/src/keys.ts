/**
 * Canonical molecular field names — the JavaScript mirror of
 * `molrs::store::keys` (Rust), which molpy also re-exports through
 * `molrs.fields`.
 *
 * molrs-wasm does not expose these constants to JS, so they are transcribed
 * here rather than each call site writing `"atomi"` inline for the fortieth
 * time. This module **defines nothing**: if a name here disagrees with
 * `molrs::store::keys`, this file is wrong.
 *
 * A drift gate lives in `python/tests/test_wire_parity.py`, which reads the
 * real `molrs.keys` and fails if these values fall out of step.
 *
 * @module
 */

/** Cartesian x-coordinate. */
export const X = "x";
/** Cartesian y-coordinate. */
export const Y = "y";
/** Cartesian z-coordinate. */
export const Z = "z";
/** The three Cartesian coordinate keys, in axis order. */
export const COORDS = [X, Y, Z] as const;

/** Element symbol of an atom (e.g. `"C"`). */
export const ELEMENT = "element";
/** Coarse-grained bead type (e.g. `"W"`). */
export const BEAD_TYPE = "bead_type";
/** Human-readable atom name (e.g. `"CA"`). */
export const NAME = "name";
/** Force-field / atom type label. */
export const TYPE = "type";

/** Partial charge. */
export const CHARGE = "charge";
/**
 * Chemical bond class: 0 unknown, 1 single, 2 double, 3 triple, 4 aromatic.
 * Orthogonal to {@link BOND_NUMBER}.
 */
export const BOND_TYPE = "bond_type";
/**
 * Integer bond number of the localized Lewis/Kekulé structure:
 * 0 unknown, 1 single, 2 double, 3 triple. Never fractional.
 */
export const BOND_NUMBER = "bond_number";
/** Atomic mass. */
export const MASS = "mass";
/** Stable per-entity identifier. */
export const ID = "id";
/** Molecule identifier (groups atoms into molecules). */
export const MOL_ID = "mol_id";

/** Cartesian x-velocity. */
export const VX = "vx";
/** Cartesian y-velocity. */
export const VY = "vy";
/** Cartesian z-velocity. */
export const VZ = "vz";
/** The three Cartesian velocity keys, in axis order. */
export const VELOCITIES = [VX, VY, VZ] as const;

/** Residue identifier (groups atoms into residues). */
export const RES_ID = "res_id";
/** Residue name (e.g. `"ALA"`). */
export const RES_NAME = "res_name";

/** First endpoint of a relation block (bond/angle/dihedral), 0-indexed. */
export const ATOMI = "atomi";
/** Second endpoint of a relation block, 0-indexed. */
export const ATOMJ = "atomj";
/** Third endpoint of a relation block (angle vertex / dihedral), 0-indexed. */
export const ATOMK = "atomk";
/** Fourth endpoint of a relation block (dihedral/improper), 0-indexed. */
export const ATOML = "atoml";
/** Relation endpoint keys in position order. */
export const ENDPOINTS = [ATOMI, ATOMJ, ATOMK, ATOML] as const;

/** Conventional block names. Not from `keys.rs` — molrs names blocks at the
 * `Frame` level, and these are the two every reader and the renderer agree on. */
export const ATOMS_BLOCK = "atoms";
/** Conventional bonds block name. */
export const BONDS_BLOCK = "bonds";
