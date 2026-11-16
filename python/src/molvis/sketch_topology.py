"""molpy structures → the 2D sketch document the sketch page loads.

The sketch draws a structure formula, not a 3D model: heavy atoms, Kekulé
bond orders, formal charges, hydrogens folded into heteroatom labels
(``OH``, ``NH₃⁺``), and port markers. :class:`SketchTopology` is that
document on the Python side, built from a molpy :class:`~molpy.Atomistic`,
a :class:`~molpy.Frame`, a frame mapping, or SMILES text.

2D coordinates
--------------
Coordinates the structure already carries win: planar ``x``/``y`` (no ``z``,
or a ``z`` that is zero everywhere) are sent as the picture. Anything else —
no coordinates, or a 3D conformer — is sent without ``x``/``y`` and the sketch
page lays the molecule out itself (``MoleculeLayout`` in
``@molcrafts/molvis-sketch``). When molpy grows a 2D coordinate generator, a
frame it produced is drawn as generated, with no change here.
"""

from __future__ import annotations

import copy
import logging
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np
from molpy.core import Atomistic, Element, Frame

from .structure import _with_kekule_orders

logger = logging.getLogger("molvis")

__all__ = ["SketchTopology"]

#: Largest |z| that still counts as a flat (2D) picture.
PLANAR_Z_TOLERANCE = 1e-6

#: molrs ``bond_type`` code for an aromatic bond.
AROMATIC_BOND_TYPE = 4

#: Bonding-descriptor openers that mark SMILES text as a ported fragment.
_DESCRIPTOR_MARKERS = ("[<", "[>", "[$", "[!")


def _with_judged_orders(molecule: Atomistic) -> Atomistic:
    """A copy with bond orders judged from the connectivity, when none is stated.

    Only for a molecule whose every hydrogen is drawn: the judgement counts
    valences, so a heavy-atom-only graph would come out with false double
    bonds. Any stated order (``bond_type``/``bond_number``) is kept as is.
    """
    from molpy.perceive import assign_bond_orders

    bonds = list(molecule.bonds)
    if not bonds or any("bond_type" in bond or "bond_number" in bond for bond in bonds):
        return molecule
    if not any(int(atom.get("atomic_number", 0)) == 1 for atom in molecule.atoms):
        return molecule
    judged = copy.deepcopy(molecule)
    assign_bond_orders(judged)
    return judged


@dataclass(frozen=True)
class SketchTopology:
    """A sketch document: atoms and bonds, coordinates optional.

    ``atoms`` holds one mapping per atom with ``element`` and, when they
    apply, ``charge``, ``hydrogens``, ``port``, ``x`` and ``y``. ``bonds``
    holds ``{"i", "j", "order"}`` with Kekulé orders 1–3. Build one with
    :meth:`from_atomistic`, :meth:`from_frame` or :meth:`from_smiles`.
    """

    atoms: tuple[Mapping[str, Any], ...]
    bonds: tuple[Mapping[str, Any], ...]

    def to_payload(self) -> dict[str, list[dict[str, Any]]]:
        """The ``sketch.load`` payload: plain JSON lists of fresh dicts."""
        return {
            "atoms": [dict(atom) for atom in self.atoms],
            "bonds": [dict(bond) for bond in self.bonds],
        }

    @property
    def has_coordinates(self) -> bool:
        """Whether every atom carries a 2D position."""
        return bool(self.atoms) and all("x" in atom for atom in self.atoms)

    @classmethod
    def from_smiles(cls, smiles: str) -> SketchTopology:
        """Parse SMILES with molpy. Bonding descriptors (``[<]``, ``[>]``,
        ``[$]``) make it a ported fragment, drawn with port markers.

        Raises:
            ValueError: molpy cannot parse the text (``SmilesError``).
        """
        from molpy.io.smiles import read_smiles, read_smiles_fragment

        text = smiles.strip()
        if any(marker in text for marker in _DESCRIPTOR_MARKERS):
            return cls.from_atomistic(read_smiles_fragment(text).to_template())
        return cls.from_atomistic(read_smiles(text).to_atomistic())

    @classmethod
    def from_atomistic(cls, molecule: Atomistic) -> SketchTopology:
        """Kekulé orders and hydrogens perceived by molpy, then folded.

        A molecule whose bonds state no order at all (PDB ``CONECT``, a
        bare connectivity) and whose hydrogens are drawn gets its orders
        judged from the connectivity (antechamber ``bondtype -j full``), so
        double bonds and aromatic rings are drawn.

        Works on a copy; *molecule* is not modified. Implicit hydrogens are
        made explicit with :func:`molpy.perceive.add_hydrogens` and then folded
        back into their heavy atom's label, so ``CCO`` reads ``OH`` and
        ``[OH-]`` reads ``OH⁻``. Port leaving atoms are dropped, not counted.
        """
        from molpy.perceive import add_hydrogens

        heavy = _with_kekule_orders(_with_judged_orders(molecule))
        planar = _planar_coordinates(heavy.to_frame()["atoms"])
        frame = add_hydrogens(heavy).to_frame()
        coords = None
        if planar is not None:
            # add_hydrogens appends; the heavy atoms keep their rows.
            n_new = frame["atoms"].n_rows - len(planar[0])
            pad = np.full(n_new, np.nan)
            coords = (np.concatenate([planar[0], pad]), np.concatenate([planar[1], pad]))
        return cls._from_columns(frame, coords=coords, implicit_h=False)

    @classmethod
    def from_frame(cls, frame: Frame | Mapping[str, Any]) -> SketchTopology:
        """From a molpy Frame or a ``{"blocks": …}`` mapping.

        A Frame whose atoms carry ``atomic_number``, or an ``element`` symbol
        on every row (as mol2, PDB and SDF readers give), goes through
        :meth:`from_atomistic` (hydrogen and Kekulé perception). Anything
        else is read column by column: ``element``/``atomic_number``,
        ``formal_charge``, ``h_count``, planar ``x``/``y``, ``bonds`` and a
        ``ports`` block; explicit terminal hydrogens are still folded.
        """
        if isinstance(frame, Frame) and "atoms" in frame:
            atoms = frame["atoms"]
            if "atomic_number" in atoms:
                return cls.from_atomistic(Atomistic.from_frame(frame))
            if "element" in atoms and all(str(sym).strip() for sym in atoms["element"]):
                numbered = frame.copy()
                Element.fill_atomic_numbers(numbered)
                return cls.from_atomistic(Atomistic.from_frame(numbered))
        return cls._from_columns(frame, coords=None, implicit_h=True)

    @classmethod
    def _from_columns(
        cls,
        frame: Frame | Mapping[str, Any],
        *,
        coords: tuple[np.ndarray, np.ndarray] | None,
        implicit_h: bool,
    ) -> SketchTopology:
        atoms_block = _block(frame, "atoms")
        if atoms_block is None:
            return cls(atoms=(), bonds=())
        elements = _elements(atoms_block)
        n = len(elements)
        charges = _int_column(atoms_block, "formal_charge", n)
        h_counts = (
            _int_column(atoms_block, "h_count", n) if implicit_h else np.zeros(n, int)
        )
        if coords is None:
            coords = _planar_coordinates(atoms_block)
        bonds = _bonds(_block(frame, "bonds"), n)
        ports, handles = _ports(_block(frame, "ports"), n)
        # A hydrogen a port would remove on linking is not part of the
        # picture: drop it without counting it into its anchor's label.
        leaving = {h for h in handles if elements[h] == "H"}
        folded = _foldable_hydrogens(elements, charges, bonds, set(ports) | leaving)
        dropped = set(folded) | leaving
        hydrogens = h_counts.copy()
        for heavy in folded.values():
            hydrogens[heavy] += 1
        keep = [index for index in range(n) if index not in dropped]
        remap = {old: new for new, old in enumerate(keep)}

        has_xy = coords is not None and all(
            np.isfinite(coords[0][i]) and np.isfinite(coords[1][i]) for i in keep
        )
        atoms: list[dict[str, Any]] = []
        for old in keep:
            atom: dict[str, Any] = {"element": elements[old]}
            if charges[old]:
                atom["charge"] = int(charges[old])
            if hydrogens[old]:
                atom["hydrogens"] = int(hydrogens[old])
            if old in ports:
                atom["port"] = ports[old]
            if has_xy and coords is not None:
                atom["x"] = float(coords[0][old])
                atom["y"] = float(coords[1][old])
            atoms.append(atom)
        kept_bonds = tuple(
            {"i": remap[i], "j": remap[j], "order": order}
            for i, j, order in bonds
            if i in remap and j in remap
        )
        return cls(atoms=tuple(atoms), bonds=kept_bonds)


def _block(frame: Frame | Mapping[str, Any], name: str) -> Any | None:
    if isinstance(frame, Frame):
        # molpy.Frame has no .get(); membership then indexing is its API.
        return frame[name] if name in frame else None  # noqa: SIM401
    blocks = frame.get("blocks") if isinstance(frame, Mapping) else None
    if not isinstance(blocks, Mapping):
        raise TypeError("expected a molpy Frame or a mapping with 'blocks'")
    block = blocks.get(name)
    return block if isinstance(block, Mapping) else None


def _has(block: Any, key: str) -> bool:
    return key in block


def _elements(block: Any) -> list[str]:
    if _has(block, "element"):
        return [str(symbol) or "C" for symbol in block["element"]]
    if _has(block, "atomic_number"):
        return [
            Element.by_number(int(z)).symbol if int(z) else "*"
            for z in block["atomic_number"]
        ]
    raise ValueError("atoms need an 'element' or 'atomic_number' column")


def _int_column(block: Any, key: str, n: int) -> np.ndarray:
    if not _has(block, key):
        return np.zeros(n, dtype=int)
    values = np.asarray(block[key])
    if values.shape != (n,):
        raise ValueError(f"atoms.{key} must have one value per atom")
    return np.rint(values.astype(float)).astype(int)


def _planar_coordinates(block: Any) -> tuple[np.ndarray, np.ndarray] | None:
    """``(x, y)`` when the atoms carry a flat 2D picture, else ``None``."""
    if not (_has(block, "x") and _has(block, "y")):
        return None
    x = np.asarray(block["x"], dtype=float)
    y = np.asarray(block["y"], dtype=float)
    if _has(block, "z"):
        z = np.asarray(block["z"], dtype=float)
        if np.any(np.abs(z) > PLANAR_Z_TOLERANCE):
            return None
    if not (np.all(np.isfinite(x)) and np.all(np.isfinite(y))):
        return None
    return x, y


def _bonds(block: Any | None, n: int) -> list[tuple[int, int, int]]:
    if block is None:
        return []
    ikey = "atomi" if _has(block, "atomi") else "i"
    jkey = "atomj" if _has(block, "atomj") else "j"
    if not (_has(block, ikey) and _has(block, jkey)):
        raise ValueError("bonds need 'atomi'/'atomj' columns")
    atomi = [int(v) for v in block[ikey]]
    atomj = [int(v) for v in block[jkey]]
    count = len(atomi)
    numbers = [int(v) for v in block["bond_number"]] if _has(block, "bond_number") else [0] * count
    types = [int(v) for v in block["bond_type"]] if _has(block, "bond_type") else [0] * count
    out: list[tuple[int, int, int]] = []
    unresolved = 0
    for k in range(count):
        i, j = atomi[k], atomj[k]
        if not (0 <= i < n and 0 <= j < n) or i == j:
            raise ValueError(f"bond ({i}, {j}) is invalid for {n} atoms")
        order = numbers[k] if 1 <= numbers[k] <= 3 else types[k]
        if order == AROMATIC_BOND_TYPE or not 1 <= order <= 3:
            unresolved += order == AROMATIC_BOND_TYPE
            order = 1
        out.append((i, j, order))
    if unresolved:
        logger.warning(
            "sketch: %d aromatic bond(s) have no Kekulé order; drawn as single. "
            "Pass an Atomistic (molpy perceives Kekulé orders) to draw them.",
            unresolved,
        )
    return out


def _ports(block: Any | None, n: int) -> tuple[dict[int, str], set[int]]:
    """Port text per anchor atom, and the set of leaving (handle) atoms."""
    if block is None or not _has(block, "atomi"):
        return {}, set()
    anchors = [int(v) for v in block["atomi"]]
    handles = [int(v) for v in block["atomj"]] if _has(block, "atomj") else []
    kinds = [str(v) for v in block["port_kind"]] if _has(block, "port_kind") else []
    labels = [str(v) for v in block["port_label"]] if _has(block, "port_label") else []
    ports: dict[int, str] = {}
    for row, anchor in enumerate(anchors):
        if not 0 <= anchor < n:
            raise ValueError(f"port anchor {anchor} is out of range for {n} atoms")
        text = (kinds[row] if row < len(kinds) else "") + (
            labels[row] if row < len(labels) else ""
        )
        text = text or "*"
        ports[anchor] = f"{ports[anchor]} {text}" if anchor in ports else text
    return ports, {h for h in handles if 0 <= h < n and h not in ports}


def _foldable_hydrogens(
    elements: Sequence[str],
    charges: np.ndarray,
    bonds: Sequence[tuple[int, int, int]],
    excluded: set[int],
) -> dict[int, int]:
    """Terminal, neutral H atoms bonded to one heavy atom → that atom."""
    neighbors: dict[int, list[int]] = {}
    for i, j, _order in bonds:
        neighbors.setdefault(i, []).append(j)
        neighbors.setdefault(j, []).append(i)
    folded: dict[int, int] = {}
    for index, element in enumerate(elements):
        if element != "H" or charges[index] or index in excluded:
            continue
        adjacent = neighbors.get(index, [])
        if len(adjacent) == 1 and elements[adjacent[0]] != "H":
            folded[index] = adjacent[0]
    return folded
