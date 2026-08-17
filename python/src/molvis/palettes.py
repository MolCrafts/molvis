from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Literal
import struct
from math import ceil, sqrt
import zlib

__all__ = [
    "normalize_hex_color",
    "PaletteDefinition",
    "PaletteEntry",
    "PaletteInfo",
    "render_palette_preview",
    "save_palette_preview_bytes",
]

PaletteKind = Literal["element", "categorical"]


@dataclass(frozen=True)
class PaletteInfo:
    name: str
    kind: PaletteKind
    size: int


@dataclass(frozen=True)
class PaletteEntry:
    label: str
    color: str


@dataclass(frozen=True)
class PaletteDefinition:
    name: str
    kind: PaletteKind
    size: int
    entries: list[PaletteEntry]


def normalize_hex_color(value: str) -> str:
    """Validate a ``#RRGGBB`` / ``#RRGGBBAA`` colour and return it upper-cased.

    The stage parses the same two forms, so anything this accepts can be
    handed straight to ``view.set_background``. Rejecting here means a typo
    surfaces at construction with the offending value, not as a silently
    black canvas several RPCs later.
    """
    text = str(value).strip()
    body = text[1:] if text.startswith("#") else text
    if len(body) not in (6, 8) or any(c not in "0123456789abcdefABCDEF" for c in body):
        raise ValueError(
            f"Expected a #RRGGBB or #RRGGBBAA color, got {value!r}"
        )
    return "#" + body.upper()


def _parse_hex_color(value: str) -> tuple[int, int, int]:
    hex_color = value.lstrip("#")
    if len(hex_color) != 6:
        raise ValueError(f"Expected a #RRGGBB color, got '{value}'")
    return (
        int(hex_color[0:2], 16),
        int(hex_color[2:4], 16),
        int(hex_color[4:6], 16),
    )


def _png_chunk(tag: bytes, payload: bytes) -> bytes:
    header = struct.pack(">I", len(payload)) + tag + payload
    checksum = zlib.crc32(tag + payload) & 0xFFFFFFFF
    return header + struct.pack(">I", checksum)


def _encode_png(width: int, height: int, rgb: bytes) -> bytes:
    stride = width * 3
    rows = bytearray()
    for offset in range(0, len(rgb), stride):
        rows.append(0)
        rows.extend(rgb[offset : offset + stride])

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    idat = zlib.compress(bytes(rows), level=9)
    return b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            _png_chunk(b"IHDR", ihdr),
            _png_chunk(b"IDAT", idat),
            _png_chunk(b"IEND", b""),
        ]
    )


def _fill_rect(
    buffer: bytearray,
    width: int,
    x0: int,
    y0: int,
    rect_width: int,
    rect_height: int,
    color: tuple[int, int, int],
) -> None:
    r, g, b = color
    for y in range(y0, y0 + rect_height):
        row_offset = y * width * 3
        for x in range(x0, x0 + rect_width):
            idx = row_offset + x * 3
            buffer[idx] = r
            buffer[idx + 1] = g
            buffer[idx + 2] = b


def _normalize_entries(
    entries: Iterable[PaletteEntry | tuple[str, str]],
) -> list[PaletteEntry]:
    normalized: list[PaletteEntry] = []
    for entry in entries:
        if isinstance(entry, PaletteEntry):
            normalized.append(entry)
        else:
            label, color = entry
            normalized.append(PaletteEntry(str(label), str(color)))
    return normalized


def render_palette_preview(
    entries: Iterable[PaletteEntry | tuple[str, str]],
    *,
    columns: int | None = None,
    swatch_size: int = 24,
    gap: int = 4,
    padding: int = 12,
    background: str = "#111111",
) -> bytes:
    normalized = _normalize_entries(entries)
    if not normalized:
        raise ValueError("Palette preview requires at least one color")
    if swatch_size <= 0:
        raise ValueError("swatch_size must be > 0")
    if gap < 0 or padding < 0:
        raise ValueError("gap and padding must be >= 0")

    count = len(normalized)
    if columns is None:
        columns = min(16, max(1, int(ceil(sqrt(count)))))
    if columns <= 0:
        raise ValueError("columns must be > 0")

    rows = int(ceil(count / columns))
    width = padding * 2 + columns * swatch_size + max(0, columns - 1) * gap
    height = padding * 2 + rows * swatch_size + max(0, rows - 1) * gap
    background_rgb = _parse_hex_color(background)

    rgb = bytearray(width * height * 3)
    _fill_rect(rgb, width, 0, 0, width, height, background_rgb)

    for index, entry in enumerate(normalized):
        col = index % columns
        row = index // columns
        x = padding + col * (swatch_size + gap)
        y = padding + row * (swatch_size + gap)
        _fill_rect(
            rgb, width, x, y, swatch_size, swatch_size, _parse_hex_color(entry.color)
        )

    return _encode_png(width, height, bytes(rgb))


def save_palette_preview_bytes(data: bytes, path: str | Path) -> Path:
    output = Path(path).expanduser().resolve()
    output.write_bytes(data)
    return output
