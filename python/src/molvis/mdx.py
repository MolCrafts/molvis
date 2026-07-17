"""Zensical/Python-Markdown formatters for MolVis web components."""

from __future__ import annotations

from html import escape
from typing import Any, Mapping

FORMATS = {
    "pdb",
    "xyz",
    "cif",
    "lammps",
    "lammps-dump",
    "sdf",
    "dcd",
    "cube",
    "chgcar",
    "gro",
    "mol2",
    "poscar",
    "trr",
    "xtc",
}
CONTROLS = {
    "view",
    "trajectory",
    "mode",
    "info",
    "performance",
    "context-menu",
}
MODES = {"view", "select", "edit", "manipulate", "measure"}
REPRESENTATIONS = {
    "ball-and-stick",
    "flat",
    "ball-and-tube",
    "tube",
    "metal-tube",
    "wireframe",
    "bubble",
    "spacefill",
    "skeletal",
    "graph",
}
ATTRIBUTES = {
    "format",
    "controls",
    "modes",
    "mode",
    "representation",
    "background",
    "width",
    "height",
}
GALLERY_ATTRIBUTES = {
    "src",
    "format",
    "representations",
    "background",
    "rotation-speed",
}


def _tokens(value: str) -> set[str]:
    return {item for item in value.split() if item}


def _validate(attrs: Mapping[str, str]) -> None:
    unknown = set(attrs) - ATTRIBUTES
    if unknown:
        raise ValueError(f"Unknown molvis fence attribute(s): {', '.join(sorted(unknown))}")

    format_name = attrs.get("format", "").strip()
    if not format_name:
        raise ValueError("A molvis fence requires format=\"pdb\", format=\"xyz\", etc.")
    if format_name not in FORMATS:
        raise ValueError(f"Unsupported molvis format: {format_name}")

    controls = _tokens(attrs.get("controls", "view trajectory"))
    invalid_controls = controls - CONTROLS
    if invalid_controls:
        raise ValueError(f"Unknown molvis control(s): {', '.join(sorted(invalid_controls))}")

    modes = _tokens(attrs.get("modes", "view"))
    invalid_modes = modes - MODES
    if invalid_modes:
        raise ValueError(f"Unknown molvis mode(s): {', '.join(sorted(invalid_modes))}")
    if "view" not in modes:
        raise ValueError('molvis fence modes must include "view"')

    mode = attrs.get("mode", "view")
    if mode not in modes:
        raise ValueError(f'Initial molvis mode "{mode}" is not included in modes')

    representation = attrs.get("representation", "ball-and-stick")
    if representation not in REPRESENTATIONS:
        raise ValueError(f"Unknown molvis representation: {representation}")


def _validate_gallery(source: str, attrs: Mapping[str, str]) -> None:
    unknown = set(attrs) - GALLERY_ATTRIBUTES
    if unknown:
        raise ValueError(
            f"Unknown molvis-gallery fence attribute(s): {', '.join(sorted(unknown))}"
        )

    src = attrs.get("src", "").strip()
    has_inline_source = bool(source.strip())
    if src and has_inline_source:
        raise ValueError("A molvis-gallery fence accepts either src or inline source, not both")
    if not src and not has_inline_source:
        raise ValueError("A molvis-gallery fence requires src or inline molecular source")

    format_name = attrs.get("format", "").strip()
    if has_inline_source and not format_name:
        raise ValueError("An inline molvis-gallery fence requires format")
    if format_name and format_name not in FORMATS:
        raise ValueError(f"Unsupported molvis format: {format_name}")

    representations = _tokens(attrs.get("representations", ""))
    invalid_representations = representations - REPRESENTATIONS
    if invalid_representations:
        raise ValueError(
            "Unknown molvis representation(s): "
            + ", ".join(sorted(invalid_representations))
        )

    rotation_speed = attrs.get("rotation-speed", "0.08")
    try:
        speed = float(rotation_speed)
    except ValueError as error:
        raise ValueError("molvis-gallery rotation-speed must be a number") from error
    if speed < 0:
        raise ValueError("molvis-gallery rotation-speed must be non-negative")


def molvis_fence(
    source: str,
    language: str,
    css_class: str,
    options: Mapping[str, str],
    md: Any,
    **kwargs: Any,
) -> str:
    """Turn a fenced molecular text file into a ``molvis-viewer`` element.

    Rendering remains entirely browser-side. This formatter only validates and
    escapes author input, then emits the same element available to raw HTML.
    """

    del language, options, md
    attrs = {str(key): str(value) for key, value in kwargs.get("attrs", {}).items()}
    _validate(attrs)

    rendered_attrs = [f'{key}="{escape(value, quote=True)}"' for key, value in attrs.items()]
    classes = [css_class, *kwargs.get("classes", [])]
    classes = [value for value in classes if value]
    if classes:
        rendered_attrs.append(f'class="{escape(" ".join(classes), quote=True)}"')
    if id_value := kwargs.get("id_value"):
        rendered_attrs.append(f'id="{escape(str(id_value), quote=True)}"')

    attributes = " ".join(rendered_attrs)
    content = escape(source, quote=False)
    return (
        f"<molvis-viewer {attributes}>"
        f"<template data-molvis-source>{content}</template>"
        "</molvis-viewer>"
    )


def molvis_gallery_fence(
    source: str,
    language: str,
    css_class: str,
    options: Mapping[str, str],
    md: Any,
    **kwargs: Any,
) -> str:
    """Emit a read-only multi-canvas style gallery from one molecular source.

    Authors use only a fenced block. The generated component creates one
    BabylonJS engine and a separate scene/canvas view for every requested
    representation.
    """

    del language, options, md
    attrs = {str(key): str(value) for key, value in kwargs.get("attrs", {}).items()}
    _validate_gallery(source, attrs)

    rendered_attrs = [f'{key}="{escape(value, quote=True)}"' for key, value in attrs.items()]
    classes = [css_class, *kwargs.get("classes", [])]
    classes = [value for value in classes if value]
    if classes:
        rendered_attrs.append(f'class="{escape(" ".join(classes), quote=True)}"')
    if id_value := kwargs.get("id_value"):
        rendered_attrs.append(f'id="{escape(str(id_value), quote=True)}"')

    attributes = " ".join(rendered_attrs)
    if source.strip():
        content = (
            "<template data-molvis-source>"
            f"{escape(source, quote=False)}"
            "</template>"
        )
    else:
        content = ""
    return f"<molvis-style-gallery {attributes}>{content}</molvis-style-gallery>"
