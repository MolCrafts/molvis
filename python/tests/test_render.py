"""``molvis.render``: spec checking and the panel loop, without a browser."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import molpy as mp
import numpy as np
import pytest
from molvis.commands.snapshot import Capture
from molvis.render import RenderSpecError, load_spec, render


def write_spec(tmp_path: Path, **fields) -> Path:
    spec = {"panels": [{"structure": "a.pdb", "output": "a.png"}], **fields}
    path = tmp_path / "spec.json"
    path.write_text(json.dumps(spec))
    return path


class FakeScene:
    """Records the calls a render makes; the camera radius follows fit(), and
    atom i projects to canvas point (10 i, 5)."""

    def __init__(self, radii: dict[int, float]):
        self.calls: list[tuple] = []
        self.radii = radii  # atom count → radius fit() frames it at
        self.n_atoms = 0
        self.radius = 0.0
        scene = self
        self.camera = SimpleNamespace(
            get_pose=lambda: SimpleNamespace(radius=scene.radius),
            set_pose=lambda **kw: scene._set_pose(**kw),
            project=lambda idx: [(10.0 * i, 5.0, 0.5) for i in idx],
        )

    def _set_pose(self, **kw):
        self.calls.append(("set_pose", kw))
        if "radius" in kw:
            self.radius = kw["radius"]

    def set_trajectory(self, frames, wait):
        self.n_atoms = frames[0]["atoms"].n_rows
        self.calls.append(("draw", self.n_atoms))

    def set_style(self, style):
        self.calls.append(("style", style))

    def color_atoms(self, indices, color, reset=False):
        self.calls.append(("color", tuple(indices), color, reset))

    def fit(self, view):
        self.radius = self.radii[self.n_atoms]
        self.calls.append(("fit", view))

    def capture(self, **kw):
        self.calls.append(("capture", kw))
        return Capture(png=b"PNG", scale=kw["scale"], crop=(4, 2, 100, 50))


def frame(n: int) -> mp.Frame:
    return mp.Frame(
        blocks={"atoms": {"x": np.zeros(n), "y": np.zeros(n), "z": np.zeros(n)}}
    )


class TestLoadSpec:
    def test_defaults_and_paths_resolve_against_the_spec(self, tmp_path):
        spec = load_spec(write_spec(tmp_path))
        assert (spec.width, spec.height, spec.scale, spec.theme) == (
            1200,
            900,
            1.0,
            "light",
        )
        assert spec.crop_margin is None and not spec.same_scale
        (panel,) = spec.panels
        assert panel.structure == tmp_path / "a.pdb"
        assert panel.output == tmp_path / "a.png"
        assert panel.view == "iso" and panel.style == "ball-and-stick"

    def test_reads_colors_anchors_and_explicit_angles(self, tmp_path):
        path = write_spec(
            tmp_path,
            panels=[
                {
                    "structure": "a.pdb",
                    "output": "out/a.png",
                    "view": {"alpha": 1.5, "beta": 1.5},
                    "colors": {"#0072B2": [0, 2], "#E69F00": [1]},
                    "anchors": [0, 1],
                }
            ],
        )
        (panel,) = load_spec(path).panels
        assert panel.view == (1.5, 1.5)
        assert panel.colors == (("#0072B2", (0, 2)), ("#E69F00", (1,)))
        assert panel.anchors == (0, 1)

    @pytest.mark.parametrize(
        ("fields", "where"),
        [
            ({"scale": 0}, "scale"),
            ({"theme": "sepia"}, "theme"),
            ({"crop_margin": -1}, "crop_margin"),
            ({"crop_margin": 4, "transparent": False}, "transparent"),
            ({"panels": []}, "panels"),
            ({"zoom": 2}, "unknown"),
            ({"panels": [{"structure": "a.pdb", "output": "a.jpg"}]}, "output"),
            (
                {"panels": [{"structure": "a.pdb", "output": "a.png", "view": "top"}]},
                "view",
            ),
            (
                {
                    "panels": [
                        {
                            "structure": "a.pdb",
                            "output": "a.png",
                            "colors": {"red": [0]},
                        }
                    ]
                },
                "colors",
            ),
            (
                {
                    "panels": [
                        {
                            "structure": "a.pdb",
                            "output": "a.png",
                            "colors": {"#000000": [0], "#FFFFFF": [0]},
                        }
                    ]
                },
                "both",
            ),
        ],
    )
    def test_names_the_wrong_field(self, tmp_path, fields, where):
        with pytest.raises(RenderSpecError, match=where):
            load_spec(write_spec(tmp_path, **fields))


class TestRender:
    def test_one_panel_draws_colors_and_reports_anchors_in_png_pixels(self, tmp_path):
        spec = load_spec(
            write_spec(
                tmp_path,
                scale=3,
                crop_margin=8,
                panels=[
                    {
                        "structure": "a.pdb",
                        "output": "a.png",
                        "view": "-y",
                        "colors": {"#0072B2": [0]},
                        "anchors": [1],
                    }
                ],
            )
        )
        scene = FakeScene({2: 10.0})
        (entry,) = render(spec, scene, lambda _: frame(2))
        assert (tmp_path / "a.png").read_bytes() == b"PNG"
        assert entry["size"] == [100, 50] and entry["radius"] == 10.0
        # canvas (10, 5) × scale 3, minus the crop origin (4, 2)
        assert entry["anchors"] == {"1": [26.0, 13.0]}
        assert ("color", (), None, True) in scene.calls  # earlier panel's colors go
        assert ("color", (0,), "#0072B2", False) in scene.calls
        assert ("fit", "-y") in scene.calls
        shot = next(c for c in scene.calls if c[0] == "capture")[1]
        assert shot["scale"] == 3 and shot["axes"] is False and shot["crop_margin"] == 8

    def test_same_scale_renders_every_panel_at_the_widest_framing(self, tmp_path):
        spec = load_spec(
            write_spec(
                tmp_path,
                same_scale=True,
                panels=[
                    {"structure": "small.pdb", "output": "a.png"},
                    {"structure": "big.pdb", "output": "b.png"},
                ],
            )
        )
        sizes = {"small.pdb": 3, "big.pdb": 30}
        scene = FakeScene({3: 5.0, 30: 20.0})
        report = render(spec, scene, lambda p: frame(sizes[p.name]))
        assert [r["radius"] for r in report] == [20.0, 20.0]

    def test_an_atom_the_structure_lacks_fails_before_drawing(self, tmp_path):
        spec = load_spec(
            write_spec(
                tmp_path,
                panels=[
                    {
                        "structure": "a.pdb",
                        "output": "a.png",
                        "colors": {"#000000": [5]},
                    }
                ],
            )
        )
        scene = FakeScene({2: 1.0})
        with pytest.raises(RenderSpecError, match="atom 5"):
            render(spec, scene, lambda _: frame(2))
        assert scene.calls == []


def test_capture_maps_canvas_points_into_the_png():
    assert Capture(b"", 2.0, None).to_image(3.0, 4.0) == (6.0, 8.0)
    assert Capture(b"", 2.0, (5, 1, 9, 9)).to_image(3.0, 4.0) == (1.0, 7.0)


def typed_frame(names: list[str]) -> mp.Frame:
    n = len(names)
    return mp.Frame(
        blocks={
            "atoms": {
                "x": np.zeros(n),
                "y": np.zeros(n),
                "z": np.zeros(n),
                "name": np.array(names),
            }
        }
    )


class TestColorBy:
    def spec(self, tmp_path, palette):
        return load_spec(
            write_spec(
                tmp_path,
                palette=palette,
                panels=[
                    {
                        "structure": "a.mol2",
                        "output": "a.png",
                        "color_by": "name",
                        "colors": {"#000000": [2]},
                    }
                ],
            )
        )

    def test_one_color_per_value_then_explicit_colors(self, tmp_path):
        spec = self.spec(tmp_path, {"oh": "#D55E00", "c3": "#4D4D4D"})
        scene = FakeScene({3: 1.0})
        render(spec, scene, lambda _: typed_frame(["oh", "c3", "c3"]))
        colors = [c[1:3] for c in scene.calls if c[0] == "color" and c[1]]
        # by value first, explicit colors last so they win
        assert colors[:3] == [((0,), "#D55E00"), ((1, 2), "#4D4D4D"), ((2,), "#000000")]

    def test_a_value_without_a_color_fails_before_drawing(self, tmp_path):
        spec = self.spec(tmp_path, {"oh": "#D55E00"})
        scene = FakeScene({3: 1.0})
        with pytest.raises(RenderSpecError, match=r"\['c3'\]"):
            render(spec, scene, lambda _: typed_frame(["oh", "c3", "c3"]))
        assert scene.calls == []

    def test_a_missing_column_is_named(self, tmp_path):
        spec = self.spec(tmp_path, {})
        with pytest.raises(RenderSpecError, match="no atom column 'name'"):
            render(spec, FakeScene({3: 1.0}), lambda _: frame(3))

    def test_palette_colors_are_checked(self, tmp_path):
        with pytest.raises(RenderSpecError, match="palette"):
            load_spec(write_spec(tmp_path, palette={"oh": "red"}))
