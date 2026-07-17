from __future__ import annotations

import pytest
from markdown import Markdown

from molvis.mdx import molvis_fence, molvis_gallery_fence


def render(source: str) -> str:
    md = Markdown(
        extensions=["attr_list", "pymdownx.superfences"],
        extension_configs={
            "pymdownx.superfences": {
                "custom_fences": [
                    {"name": "molvis", "class": "molvis", "format": molvis_fence},
                    {
                        "name": "molvis-gallery",
                        "class": "molvis-gallery",
                        "format": molvis_gallery_fence,
                    },
                ]
            }
        },
    )
    return md.convert(source)


def test_molvis_fence_emits_viewer_and_escaped_inline_source():
    html = render(
        '```molvis {format="xyz" modes="view edit" controls="view trajectory"}\n'
        "2\nwater & ions\nH 0 0 0\nO <1 0 0\n```"
    )
    assert '<molvis-viewer format="xyz" modes="view edit"' in html
    assert "<template data-molvis-source>" in html
    assert "water &amp; ions" in html
    assert "O &lt;1 0 0" in html


@pytest.mark.parametrize(
    "attrs, message",
    [
        ({}, "requires format"),
        ({"format": "bogus"}, "Unsupported molvis format"),
        ({"format": "pdb", "modes": "edit"}, 'must include "view"'),
        ({"format": "pdb", "controls": "view bogus"}, "Unknown molvis control"),
    ],
)
def test_molvis_fence_rejects_invalid_configuration(attrs, message):
    with pytest.raises(ValueError, match=message):
        molvis_fence("ATOM", "molvis", "molvis", {}, None, attrs=attrs)


def test_molvis_gallery_fence_emits_shared_engine_component():
    html = render(
        '```molvis-gallery {format="xyz" representations="flat spacefill" '
        'rotation-speed="0.06"}\n'
        "2\nH2 & molecule\nH 0 0 0\nH 0 0 1\n```"
    )
    assert '<molvis-style-gallery format="xyz"' in html
    assert 'representations="flat spacefill"' in html
    assert "<template data-molvis-source>" in html
    assert "H2 &amp; molecule" in html


def test_molvis_gallery_fence_supports_remote_source_without_inline_html():
    html = molvis_gallery_fence(
        "",
        "molvis-gallery",
        "molvis-gallery",
        {},
        None,
        attrs={"src": "../assets/aspirin.sdf", "format": "sdf"},
    )
    assert 'src="../assets/aspirin.sdf"' in html
    assert "<template" not in html


@pytest.mark.parametrize(
    "source, attrs, message",
    [
        ("", {}, "requires src or inline"),
        ("ATOM", {}, "requires format"),
        ("ATOM", {"src": "aspirin.sdf", "format": "sdf"}, "either src or inline"),
        ("ATOM", {"format": "sdf", "representations": "flat bogus"}, "Unknown molvis representation"),
        ("ATOM", {"format": "sdf", "rotation-speed": "-1"}, "must be non-negative"),
    ],
)
def test_molvis_gallery_fence_rejects_invalid_configuration(source, attrs, message):
    with pytest.raises(ValueError, match=message):
        molvis_gallery_fence(
            source,
            "molvis-gallery",
            "molvis-gallery",
            {},
            None,
            attrs=attrs,
        )
