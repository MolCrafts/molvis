/**
 * Generated from molrs `keysDocument()`. Do not edit.
 *
 * Column keys, ordered groups, block names, and frame-meta keys. The
 * strings live in the Rust schema tables. `ATOMS_BLOCK` / `BONDS_BLOCK`
 * alias `ATOMS` / `BONDS` and do not introduce a name.
 */

export const ALTLOC = "altloc";
export const ATOM_MAP = "atom_map";
export const ATOMI = "atomi";
export const ATOMIC_NUMBER = "atomic_number";
export const ATOMJ = "atomj";
export const ATOMK = "atomk";
export const ATOML = "atoml";
export const ATOMM = "atomm";
export const AXIS_X = "axis_x";
export const AXIS_Y = "axis_y";
export const AXIS_Z = "axis_z";
export const B_FACTOR = "b_factor";
export const BEAD_TYPE = "bead_type";
export const BOND_NUMBER = "bond_number";
export const BOND_TYPE = "bond_type";
export const CHAIN = "chain";
export const CHARGE = "charge";
export const ELEMENT = "element";
export const EXCLUDE_14 = "exclude_14";
export const FORMAL_CHARGE = "formal_charge";
export const FREE = "free";
export const FX = "fx";
export const FY = "fy";
export const FZ = "fz";
export const IBEAD = "ibead";
export const ICODE = "icode";
export const ID = "id";
export const IS_14 = "is_14";
export const IX = "ix";
export const IY = "iy";
export const IZ = "iz";
export const MASS = "mass";
export const MOL_ID = "mol_id";
export const MUX = "mux";
export const MUY = "muy";
export const MUZ = "muz";
export const NAME = "name";
export const OCCUPANCY = "occupancy";
export const QUATI = "quati";
export const QUATJ = "quatj";
export const QUATK = "quatk";
export const QUATW = "quatw";
export const RES_ID = "res_id";
export const RES_NAME = "res_name";
export const STYLE = "style";
export const TYPE = "type";
export const TYPE_ID = "type_id";
export const VX = "vx";
export const VY = "vy";
export const VZ = "vz";
export const X = "x";
export const Y = "y";
export const Z = "z";

export const COORDS = [X, Y, Z] as const;
export const IMAGES = [IX, IY, IZ] as const;
export const VELOCITIES = [VX, VY, VZ] as const;
export const FORCES = [FX, FY, FZ] as const;
export const QUAT = [QUATW, QUATI, QUATJ, QUATK] as const;
export const DIPOLE = [MUX, MUY, MUZ] as const;
export const AXIS = [AXIS_X, AXIS_Y, AXIS_Z] as const;
export const ENDPOINTS = [ATOMI, ATOMJ, ATOMK, ATOML, ATOMM] as const;

export const ATOM_TYPE_LABELS = "atom_type_labels";
export const BOND_TYPE_LABELS = "bond_type_labels";
export const ANGLE_TYPE_LABELS = "angle_type_labels";
export const DIHEDRAL_TYPE_LABELS = "dihedral_type_labels";
export const IMPROPER_TYPE_LABELS = "improper_type_labels";
export const CMAP_TYPE_LABELS = "cmap_type_labels";
export const UNITS = "units";

export const ANGLES = "angles";
export const ATOMS = "atoms";
export const BONDS = "bonds";
export const CMAPS = "cmaps";
export const CONSTRAINTS = "constraints";
export const DIHEDRALS = "dihedrals";
export const DRUDES = "drudes";
export const EXCLUSIONS = "exclusions";
export const IMPROPERS = "impropers";
export const MEMBERS = "members";
export const PAIRS = "pairs";
export const VIRTUAL_SITES = "virtual_sites";

export const TOPOLOGY = [BONDS, ANGLES, DIHEDRALS, IMPROPERS] as const;

export const ATOMS_BLOCK = ATOMS;
export const BONDS_BLOCK = BONDS;
