"""Drive the modifier pipeline from Python.

Both the React sidebar and these commands edit the same pipeline, so
anything built here shows up in the UI immediately — same ids, same
order, same enabled state.

Run: ``python python/examples/pipeline_crud.py``
"""

from __future__ import annotations

import time

import molpy as mp
import numpy as np

import molvis as mv


def demo_water() -> mp.Frame:
    """A tiny H2O frame so the pipeline has something to operate on."""
    return mp.Frame(
        blocks={
            "atoms": {
                "element": np.array(["O", "H", "H"]),
                "x": np.array([0.0, 0.96, -0.24], dtype=np.float64),
                "y": np.array([0.0, 0.0, 0.93], dtype=np.float64),
                "z": np.array([0.0, 0.0, 0.0], dtype=np.float64),
            },
        }
    )


def main() -> None:
    scene = mv.Molvis()
    scene.draw_frame(demo_water())

    # The first draw_frame also inserts a DataSourceModifier at the head
    # — check it's already there.
    for m in scene.list_modifiers():
        print("initial:", m.name, m.id)

    # Offer the user every registered type.
    print("\navailable modifiers:")
    for entry in scene.available_modifiers():
        print(f"  [{entry.category:<22}] {entry.name}")

    # Stack a hide-hydrogens on top of the data source.
    hide_h = scene.add_modifier("Hide Hydrogens")
    print(f"\nadded: {hide_h.name} ({hide_h.id})")

    # Selection producer + dependent modifier — same shape as the sidebar:
    # attach HideSelection's selection scope to the ExpressionSelect.
    sel = scene.add_modifier("Expression Select")
    scene.add_modifier("Hide Selection", selection_scope_id=sel.id)

    time.sleep(2)

    # Toggle, reorder, clear.
    scene.set_modifier_enabled(hide_h.id, False)
    scene.reorder_modifier(hide_h.id, 1)

    time.sleep(2)

    scene.clear_pipeline()
    print("\npipeline cleared")


if __name__ == "__main__":
    main()
