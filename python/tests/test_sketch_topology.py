"""molpy structures → the sketch document (``molvis.sketch_topology``)."""

from __future__ import annotations

import logging

import molpy as mp
import numpy as np
import pytest
from molvis.sketch_topology import SketchTopology


def _labels(topology: SketchTopology) -> list[tuple[str, int, int]]:
    return [
        (a["element"], a.get("charge", 0), a.get("hydrogens", 0)) for a in topology.atoms
    ]


def test_quaternary_ammonium_keeps_its_charge_and_kekule_ring() -> None:
    topology = SketchTopology.from_smiles("c1ccc(CCC[N+](C)(C)C)cc1")
    assert len(topology.atoms) == 13  # heavy atoms only; H folded into labels
    nitrogen = next(a for a in topology.atoms if a["element"] == "N")
    assert nitrogen.get("charge") == 1
    assert "hydrogens" not in nitrogen
    ring_orders = sorted(b["order"] for b in topology.bonds)
    assert ring_orders.count(2) == 3  # Kekulé benzene, never aromatic "4"
    assert set(ring_orders) <= {1, 2}
    assert not topology.has_coordinates  # the page lays it out


def test_hydroxide_reads_oh_minus() -> None:
    assert _labels(SketchTopology.from_smiles("[OH-]")) == [("O", -1, 1)]


def test_organic_subset_hydrogens_are_perceived() -> None:
    assert _labels(SketchTopology.from_smiles("CCO"))[-1] == ("O", 0, 1)


def test_bonding_descriptors_become_ports_without_leaving_hydrogens() -> None:
    topology = SketchTopology.from_smiles("[<]OCC[>]")
    assert [a["element"] for a in topology.atoms] == ["O", "C", "C"]
    assert [a.get("port") for a in topology.atoms] == ["<", None, ">"]
    # The leaving H of the O port is not shown as OH.
    assert "hydrogens" not in topology.atoms[0]


def test_frame_ports_block_marks_the_anchor() -> None:
    mol = mp.io.smiles.read_smiles("c1ccc(CCCBr)cc1").to_atomistic()
    bromine = next(a for a in mol.atoms if a["atomic_number"] == 35)
    carbon = mol.neighbors(bromine)[0][0]
    mol.add_port(carbon, bromine, kind="$", label="R")
    topology = SketchTopology.from_atomistic(mol)
    ported = [a for a in topology.atoms if "port" in a]
    assert [a["port"] for a in ported] == ["$R"]
    # A heavy leaving group stays in the picture.
    assert any(a["element"] == "Br" for a in topology.atoms)


def test_from_atomistic_does_not_touch_the_input() -> None:
    mol = mp.io.smiles.read_smiles("c1ccccc1O").to_atomistic()
    before = mol.n_atoms
    SketchTopology.from_atomistic(mol)
    assert mol.n_atoms == before


def test_a_3d_conformer_is_laid_out_not_projected() -> None:
    embedded, _report = mp.conformer.Conformer(seed=1).generate(
        mp.io.smiles.read_smiles("CCO").to_atomistic()
    )
    topology = SketchTopology.from_frame(embedded.to_frame())
    assert _labels(topology) == [("C", 0, 3), ("C", 0, 2), ("O", 0, 1)]
    assert not topology.has_coordinates


def test_planar_coordinates_are_kept() -> None:
    frame = {
        "blocks": {
            "atoms": {
                "element": ["C", "O", "H"],
                "x": [0.0, 1.2, 2.0],
                "y": [0.0, 0.0, 0.5],
                "z": [0.0, 0.0, 0.0],
            },
            "bonds": {"atomi": [0, 1], "atomj": [1, 2], "bond_number": [1, 1]},
        }
    }
    topology = SketchTopology.from_frame(frame)
    assert topology.to_payload() == {
        "atoms": [
            {"element": "C", "x": 0.0, "y": 0.0},
            {"element": "O", "hydrogens": 1, "x": 1.2, "y": 0.0},
        ],
        "bonds": [{"i": 0, "j": 1, "order": 1}],
    }


def test_unkekulized_aromatic_mapping_warns_and_draws_single(
    caplog: pytest.LogCaptureFixture,
) -> None:
    frame = {
        "blocks": {
            "atoms": {"element": ["C", "C"]},
            "bonds": {"atomi": [0], "atomj": [1], "bond_type": [4], "bond_number": [0]},
        }
    }
    with caplog.at_level(logging.WARNING, logger="molvis"):
        topology = SketchTopology.from_frame(frame)
    assert topology.bonds == ({"i": 0, "j": 1, "order": 1},)
    assert "Kekulé" in caplog.text


def test_bad_input_raises() -> None:
    with pytest.raises(ValueError, match="invalid"):
        SketchTopology.from_frame(
            {"blocks": {"atoms": {"element": ["C"]}, "bonds": {"atomi": [0], "atomj": [3]}}}
        )
    with pytest.raises(ValueError, match="element"):
        SketchTopology.from_frame({"blocks": {"atoms": {"x": np.zeros(2)}}})
    with pytest.raises(TypeError, match="blocks"):
        SketchTopology.from_frame({"atoms": []})
    with pytest.raises(ValueError):
        SketchTopology.from_smiles("C1CC")


def test_payload_is_a_fresh_copy() -> None:
    topology = SketchTopology.from_smiles("[OH-]")
    payload = topology.to_payload()
    payload["atoms"][0]["element"] = "X"
    assert topology.atoms[0]["element"] == "O"


def test_mol2_frame_with_element_symbols_gets_kekule_orders(tmp_path) -> None:
    """A mol2 read back carries ``element`` but no ``atomic_number``; its
    aromatic ``ar`` bonds must still be drawn as alternating Kekulé orders."""
    rows = []
    for k in range(6):
        angle = k * np.pi / 3
        rows.append(f"{k + 1} C{k + 1} {1.4 * np.cos(angle):.4f} {1.4 * np.sin(angle):.4f} 0.0 C.ar 1 BNZ 0.0")
    for k in range(6):
        angle = k * np.pi / 3
        rows.append(f"{k + 7} H{k + 1} {2.48 * np.cos(angle):.4f} {2.48 * np.sin(angle):.4f} 0.0 H 1 BNZ 0.0")
    bonds = [f"{k + 1} {k + 1} {(k + 1) % 6 + 1} ar" for k in range(6)]
    bonds += [f"{k + 7} {k + 1} {k + 7} 1" for k in range(6)]
    text = "\n".join(
        ["@<TRIPOS>MOLECULE", "BNZ", "12 12 1 0 0", "SMALL", "USER_CHARGES", "", "@<TRIPOS>ATOM", *rows, "@<TRIPOS>BOND", *bonds, ""]
    )
    path = tmp_path / "benzene.mol2"
    path.write_text(text)
    frame = mp.io.read_mol2(path)
    assert "atomic_number" not in frame["atoms"]
    ring_orders = sorted(b["order"] for b in SketchTopology.from_frame(frame).bonds)
    assert ring_orders == [1, 1, 1, 2, 2, 2]


def _benzene_pdb(with_hydrogens: bool) -> str:
    lines = []
    for k in range(6):
        angle = k * np.pi / 3
        lines.append(f"HETATM{k + 1:5d}  C{k + 1}  BNZ A   1    {1.4 * np.cos(angle):8.3f}{1.4 * np.sin(angle):8.3f}{0.0:8.3f}  1.00  0.00           C")
    if with_hydrogens:
        for k in range(6):
            angle = k * np.pi / 3
            lines.append(f"HETATM{k + 7:5d}  H{k + 1}  BNZ A   1    {2.48 * np.cos(angle):8.3f}{2.48 * np.sin(angle):8.3f}{0.0:8.3f}  1.00  0.00           H")
    for k in range(6):
        partners = [(k + 1) % 6 + 1, (k + 5) % 6 + 1] + ([k + 7] if with_hydrogens else [])
        lines.append("CONECT" + "".join(f"{n:5d}" for n in [k + 1, *partners]))
    return "\n".join([*lines, "END", ""])


def test_pdb_with_hydrogens_gets_judged_bond_orders(tmp_path) -> None:
    """PDB ``CONECT`` states no bond order; with every hydrogen drawn the
    sketch judges them from the connectivity and draws a Kekulé ring."""
    path = tmp_path / "benzene.pdb"
    path.write_text(_benzene_pdb(with_hydrogens=True))
    frame = mp.io.read_pdb(path)
    ring_orders = sorted(b["order"] for b in SketchTopology.from_frame(frame).bonds)
    assert ring_orders == [1, 1, 1, 2, 2, 2]


def test_heavy_atom_only_graph_is_not_given_false_double_bonds(tmp_path) -> None:
    path = tmp_path / "ring.pdb"
    path.write_text(_benzene_pdb(with_hydrogens=False))
    frame = mp.io.read_pdb(path)
    assert {b["order"] for b in SketchTopology.from_frame(frame).bonds} == {1}
