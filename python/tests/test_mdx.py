from __future__ import annotations

import pytest
from markdown import Markdown

from molvis.mdx import molvis_fence


def render(source: str) -> str:
    md = Markdown(
        extensions=["attr_list", "pymdownx.superfences"],
        extension_configs={
            "pymdownx.superfences": {
                "custom_fences": [
                    {"name": "molvis", "class": "molvis", "format": molvis_fence}
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
