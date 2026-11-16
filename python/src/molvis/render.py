"""Declarative rendering: one JSON spec, several panels, one headless session.

``molvis render SPEC.json`` is the agent-facing way to make figure panels: a
spec names each structure file, its view, how its atoms are colored, and
where the PNG goes. Every panel renders in the same headless browser page, so
they share the canvas size, the theme and, with ``same_scale``, the
magnification — panels of one figure stay comparable.

Text belongs to the figure, not to the render: a raster label cannot match the
figure's typeface or scale with it. So a panel lists ``anchors`` — atoms whose
position in the PNG the report gives, in PNG pixels from the top-left — and the
figure tool (TikZ, matplotlib, …) sets labels there in its own type.

A spec::

    {
      "width": 1200, "height": 900,     // canvas, in CSS pixels
      "scale": 3,                       // PNG pixels per canvas pixel
      "theme": "light",                 // "light" | "dark"
      "style": "ball-and-stick",        // default for every panel
      "crop_margin": 12,                // crop each PNG to content (+margin px)
      "same_scale": true,               // one magnification for all panels
      "palette": {"oh": "#D55E00", "os": "#CC79A7"},  // value → color
      "panels": [
        {
          "structure": "monomer.pdb",   // relative to the spec file
          "output": "a.png",            // relative to the spec file
          "view": "-y",                 // or "iso" | "auto" | {"alpha":…, "beta":…}
          "color_by": "name",           // color each atom by this column, via palette
          "colors": {"#0072B2": [0, 4]}, // explicit colors, applied last
          "anchors": [0, 4]
        }
      ]
    }

Atoms keep their element color unless ``color_by`` or ``colors`` names them.
``color_by`` names an atom column of the structure; every value in it must
have a ``palette`` entry, so one value has one color in every panel.

The report (printed as JSON by the CLI) holds, per panel, ``output``, the
cropped PNG ``size`` (``null`` when uncropped), the camera ``radius``, and
``anchors``: ``{atom: [x, y]}``.

A cropped PNG has a transparent background (the crop reads the alpha channel).
Without ``crop_margin`` the background is the theme's, or transparent with
``"transparent": true``.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

__all__ = ["Panel", "RenderSpec", "RenderSpecError", "load_spec", "render"]

_HEX_COLOR = re.compile(r"#[0-9A-Fa-f]{6}")
_VIEW_NAMES = ("iso", "auto", "+x", "-x", "+y", "-y", "+z", "-z")
_THEMES = ("light", "dark")
_SPEC_KEYS = {
    "width",
    "height",
    "scale",
    "theme",
    "style",
    "transparent",
    "crop_margin",
    "same_scale",
    "palette",
    "panels",
}
_PANEL_KEYS = {
    "structure",
    "output",
    "style",
    "view",
    "color_by",
    "colors",
    "anchors",
}


class RenderSpecError(ValueError):
    """A render spec that cannot be rendered; the message names the field."""


@dataclass(frozen=True)
class Panel:
    """One structure rendered to one PNG."""

    structure: Path
    output: Path
    style: str
    view: str | tuple[float, float]
    color_by: str | None
    colors: tuple[tuple[str, tuple[int, ...]], ...]
    anchors: tuple[int, ...]


@dataclass(frozen=True)
class RenderSpec:
    """A checked render spec; see the module docstring for the JSON form."""

    width: int
    height: int
    scale: float
    theme: str
    transparent: bool
    crop_margin: int | None
    same_scale: bool
    palette: Mapping[str, str]
    panels: tuple[Panel, ...]


def _fail(where: str, message: str) -> RenderSpecError:
    return RenderSpecError(f"{where}: {message}")


def _unknown_keys(where: str, raw: Mapping[str, Any], allowed: set[str]) -> None:
    extra = sorted(set(raw) - allowed)
    if extra:
        raise _fail(where, f"unknown field(s) {extra}; allowed: {sorted(allowed)}")


def _is_index(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def _positive_int(where: str, value: Any) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise _fail(where, f"must be a positive integer, got {value!r}")
    return value


def _view(where: str, value: Any) -> str | tuple[float, float]:
    if isinstance(value, str):
        if value not in _VIEW_NAMES:
            raise _fail(where, f"must be one of {list(_VIEW_NAMES)}, got {value!r}")
        return value
    if isinstance(value, Mapping) and set(value) == {"alpha", "beta"}:
        try:
            return (float(value["alpha"]), float(value["beta"]))
        except (TypeError, ValueError):
            pass
    raise _fail(
        where, f'must be a view name or {{"alpha": …, "beta": …}}, got {value!r}'
    )


def _colors(where: str, value: Any) -> tuple[tuple[str, tuple[int, ...]], ...]:
    if not isinstance(value, Mapping):
        raise _fail(where, "must map '#RRGGBB' to a list of atom indices")
    out: list[tuple[str, tuple[int, ...]]] = []
    seen: dict[int, str] = {}
    for color, indices in value.items():
        if not _HEX_COLOR.fullmatch(str(color)):
            raise _fail(where, f"color must be '#RRGGBB', got {color!r}")
        if not isinstance(indices, list) or not all(_is_index(i) for i in indices):
            raise _fail(f"{where}[{color}]", "must be a list of non-negative integers")
        for i in indices:
            if i in seen:
                raise _fail(where, f"atom {i} is given both {seen[i]} and {color}")
            seen[i] = color
        out.append((color, tuple(indices)))
    return tuple(out)


def _palette(where: str, value: Any) -> dict[str, str]:
    if not isinstance(value, Mapping) or not all(
        isinstance(v, str) and _HEX_COLOR.fullmatch(v) for v in value.values()
    ):
        raise _fail(where, "must map column values to '#RRGGBB'")
    return {str(k): v for k, v in value.items()}


def _anchors(where: str, value: Any) -> tuple[int, ...]:
    if not isinstance(value, list) or not all(_is_index(i) for i in value):
        raise _fail(where, "must be a list of non-negative atom indices")
    return tuple(value)


def _panel(where: str, raw: Any, base: Path, style: str) -> Panel:
    if not isinstance(raw, Mapping):
        raise _fail(where, "must be an object")
    _unknown_keys(where, raw, _PANEL_KEYS)
    for key in ("structure", "output"):
        if not isinstance(raw.get(key), str):
            raise _fail(f"{where}.{key}", "must be a path string")
    output = base / raw["output"]
    if output.suffix.lower() != ".png":
        raise _fail(f"{where}.output", "must end in .png")
    color_by = raw.get("color_by")
    if color_by is not None and not isinstance(color_by, str):
        raise _fail(f"{where}.color_by", "must name an atom column")
    return Panel(
        structure=base / raw["structure"],
        output=output,
        style=str(raw.get("style", style)),
        view=_view(f"{where}.view", raw.get("view", "iso")),
        color_by=color_by,
        colors=_colors(f"{where}.colors", raw.get("colors", {})),
        anchors=_anchors(f"{where}.anchors", raw.get("anchors", [])),
    )


def load_spec(path: Path) -> RenderSpec:
    """Read and check a render spec; paths in it resolve against its folder.

    Raises:
        RenderSpecError: naming the first field that is wrong.
    """
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RenderSpecError(f"{path}: not JSON: {exc}") from exc
    if not isinstance(raw, Mapping):
        raise RenderSpecError(f"{path}: the spec must be a JSON object")
    _unknown_keys("spec", raw, _SPEC_KEYS)
    scale = raw.get("scale", 1)
    if not isinstance(scale, (int, float)) or isinstance(scale, bool) or scale <= 0:
        raise _fail("scale", f"must be a number > 0, got {scale!r}")
    theme = raw.get("theme", "light")
    if theme not in _THEMES:
        raise _fail("theme", f"must be one of {list(_THEMES)}, got {theme!r}")
    crop = raw.get("crop_margin")
    if crop is not None and not _is_index(crop):
        raise _fail("crop_margin", f"must be a non-negative integer, got {crop!r}")
    transparent = raw.get("transparent", False)
    if not isinstance(transparent, bool):
        raise _fail("transparent", "must be true or false")
    if crop is not None and raw.get("transparent") is False:
        raise _fail(
            "transparent", "a cropped PNG is transparent; drop transparent: false"
        )
    same_scale = raw.get("same_scale", False)
    if not isinstance(same_scale, bool):
        raise _fail("same_scale", "must be true or false")
    panels = raw.get("panels")
    if not isinstance(panels, list) or not panels:
        raise _fail("panels", "must be a non-empty list")
    style = str(raw.get("style", "ball-and-stick"))
    return RenderSpec(
        width=_positive_int("width", raw.get("width", 1200)),
        height=_positive_int("height", raw.get("height", 900)),
        scale=float(scale),
        theme=theme,
        transparent=transparent,
        crop_margin=crop,
        same_scale=same_scale,
        palette=_palette("palette", raw.get("palette", {})),
        panels=tuple(
            _panel(f"panels[{k}]", p, base=path.parent, style=style)
            for k, p in enumerate(panels)
        ),
    )


def _value_colors(
    spec: RenderSpec, panel: Panel, frame: Any, where: str
) -> list[tuple[str, list[int]]]:
    """The ``(color, rows)`` groups ``panel.color_by`` asks for."""
    if panel.color_by is None:
        return []
    atoms = frame["atoms"]
    if panel.color_by not in atoms:
        raise _fail(
            f"{where}.color_by",
            f"{panel.structure.name} has no atom column {panel.color_by!r}",
        )
    values = [str(v) for v in atoms[panel.color_by]]
    missing = sorted(set(values) - set(spec.palette))
    if missing:
        raise _fail(f"{where}.color_by", f"palette has no color for {missing}")
    groups: dict[str, list[int]] = {}
    for row, value in enumerate(values):
        groups.setdefault(spec.palette[value], []).append(row)
    return list(groups.items())


def _check_atoms(spec: RenderSpec, frames: list[Any]) -> None:
    for k, (panel, frame) in enumerate(zip(spec.panels, frames, strict=True)):
        n_atoms = frame["atoms"].n_rows
        named = [i for _, indices in panel.colors for i in indices]
        named += list(panel.anchors)
        if named and max(named) >= n_atoms:
            raise _fail(
                f"panels[{k}]",
                f"names atom {max(named)}, but {panel.structure.name} has {n_atoms} atoms",
            )


def _show(
    scene: Any,
    panel: Panel,
    frame: Any,
    by_value: list[tuple[str, list[int]]],
) -> None:
    """Draw one panel's structure and colors, and frame it."""
    scene.set_trajectory([frame], wait=True)
    scene.set_style(style=panel.style)
    scene.color_atoms([], None, reset=True)
    for color, indices in [*by_value, *panel.colors]:
        scene.color_atoms(indices, color)
    if isinstance(panel.view, tuple):
        alpha, beta = panel.view
        scene.camera.set_pose(alpha=alpha, beta=beta)
        scene.fit("current")
    else:
        scene.fit(panel.view)


def render(
    spec: RenderSpec,
    scene: Any,
    load: Callable[[Path], Any],
    timeout: float = 60.0,
) -> list[dict[str, Any]]:
    """Render every panel of ``spec`` on ``scene`` and write the PNGs.

    ``load`` reads a structure file into a frame. Returns the report the
    module docstring describes, one entry per panel.

    Raises:
        RenderSpecError: when a panel names an atom its structure lacks, or
            colors by a column that is missing or has a value the palette
            lacks; checked for every panel before anything is drawn.
    """
    frames = [load(panel.structure) for panel in spec.panels]
    _check_atoms(spec, frames)
    by_value = [
        _value_colors(spec, panel, frame, f"panels[{k}]")
        for k, (panel, frame) in enumerate(zip(spec.panels, frames, strict=True))
    ]
    radius: float | None = None
    if spec.same_scale:
        radii = []
        for panel, frame, groups in zip(spec.panels, frames, by_value, strict=True):
            _show(scene, panel, frame, groups)
            radii.append(scene.camera.get_pose().radius)
        radius = max(radii)
    report = []
    for panel, frame, groups in zip(spec.panels, frames, by_value, strict=True):
        _show(scene, panel, frame, groups)
        if radius is not None:
            scene.camera.set_pose(radius=radius)
        shot = scene.capture(
            timeout=timeout,
            scale=spec.scale,
            axes=False,
            transparent=spec.transparent,
            crop_margin=spec.crop_margin,
        )
        points = scene.camera.project(panel.anchors) if panel.anchors else []
        panel.output.parent.mkdir(parents=True, exist_ok=True)
        panel.output.write_bytes(shot.png)
        report.append(
            {
                "output": str(panel.output),
                "size": list(shot.crop[2:]) if shot.crop else None,
                "radius": scene.camera.get_pose().radius,
                "anchors": {
                    str(i): [round(v, 2) for v in shot.to_image(x, y)]
                    for i, (x, y, _) in zip(panel.anchors, points, strict=True)
                },
            }
        )
    return report
