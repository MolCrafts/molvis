"""SMILES atom classes survive the 0.20 conformer the viewer draws.

The dopamine sequence is the acceptance picture an agent builds in a cell.
These checks pin the row numbers that cell selects. They do not open a viewer.
"""

from __future__ import annotations

import math

import molpy as mp
import pytest

# (name, SMILES, (row, element, atom_map) for every non-zero class)
_CASES = [
    (
        "dopamine",
        "NCCc1ccc([OH:1])c([OH:2])c1",
        ((7, "O", 1.0), (9, "O", 2.0)),
    ),
    ("phenethylamine", "NCCc1ccccc1", ()),
    (
        "amphetamine",
        "[CH3:1][CH](N)Cc1ccccc1",
        ((0, "C", 1.0),),
    ),
    (
        "methamphetamine",
        "[CH3:1]N[CH](C)Cc1ccccc1",
        ((0, "C", 1.0),),
    ),
]


def test_molpy_minor_is_0_20() -> None:
    assert mp.__version__.startswith("0.20.")


@pytest.mark.parametrize(
    ("name", "smiles", "expected"),
    _CASES,
    ids=[case[0] for case in _CASES],
)
def test_atom_map_survives_conformer(
    name: str, smiles: str, expected: tuple[tuple[int, str, float], ...]
) -> None:
    del name
    embedded, _report = mp.conformer.Conformer(seed=1).generate(
        mp.io.smiles.read_smiles(smiles).to_atomistic()
    )
    atoms = embedded.to_frame()["atoms"]
    elements = [
        mp.Element.by_number(int(z)).symbol if z else "*"
        for z in atoms["atomic_number"]
    ]
    assert all(math.isfinite(float(value)) for value in atoms["x"])
    columns = list(atoms.keys())
    marked: list[tuple[int, str, float]] = []
    if "atom_map" in columns:
        classes = list(atoms["atom_map"])
        marked = [
            (index, elements[index], float(classes[index]))
            for index in range(len(elements))
            if classes[index]
        ]
    assert marked == list(expected)
