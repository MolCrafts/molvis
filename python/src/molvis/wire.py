"""Frame wire format — Python half of the contract in ``@molcrafts/molvis-core/wire``.

Nothing in this module invents a name or a layout.

**Names** come from :mod:`molrs.keys` (mirrored into :mod:`molrs.fields`, which
molpy re-exports). ``x``/``y``/``z``, ``element``, ``symbol``, ``type``,
``charge``, ``atomi``/``atomj``/``atomk``/``atoml``, ``bond_type``/
``bond_number`` — this module reads that registry, it does not define one,
and it never renames a column.
Translating a format-native spelling (``species``, ``q``, ``mol``) to a
canonical one is :class:`molrs.fields.FieldFormatter`'s job at the I/O boundary.

**Storage dtypes** likewise come from the registry rather than from a value's
runtime type. That is the whole point: the browser used to guess a column's
dtype from what the JSON happened to look like, so whole-number coordinates
became ``u32`` and the atoms disappeared. Here the dtype of a canonical field is
decided once, by molrs, and stated explicitly on the wire.

The four wire dtypes are the ones molrs-wasm can round-trip:

===========  =====================  ==================
wire dtype   numpy                  molrs-wasm setter
===========  =====================  ==================
``f64``      ``float64``            ``setColF``
``i32``      ``int32``              ``setColI32``
``u32``      ``uint32``             ``setColU32``
``string``   ``str`` objects        ``setColStr``
===========  =====================  ==================

``bool`` and ``u8`` blocks have no molrs-wasm setter, so they are widened here,
in Python, where the caller can see it happen — never silently in the browser.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, Literal

import molpy as mp
import numpy as np
from molrs import fields as _fields
from molrs import keys as _keys

try:
    from molrs import schema as _schema
except ImportError:  # molrs < frame-schema
    _schema = None  # type: ignore[assignment]

__all__ = [
    "ATOMS_BLOCK",
    "BONDS_BLOCK",
    "BUFFER_REF_MARKER",
    "WireError",
    "canonical_dtype",
    "decode_box",
    "decode_frame",
    "encode_box",
    "encode_frame",
    "resolve_buffers",
]

WireDType = Literal["f64", "i32", "u32", "string"]

#: Marker key identifying a binary-buffer reference inside a JSON payload.
#: Matches ``BUFFER_REF_MARKER`` in ``stage/src/transport/rpc/wire.ts``.
BUFFER_REF_MARKER = "__molvis_buffer__"

#: Conventional block names. Unlike column names these are *not* in
#: ``molrs.keys`` — molrs names blocks at the ``Frame`` level and takes whatever
#: it is given. These two are the names every molpy reader emits and the
#: renderer looks for, so they live here rather than as scattered literals.
ATOMS_BLOCK = "atoms"
BONDS_BLOCK = "bonds"


class WireError(ValueError):
    """A value that cannot be put on the wire without guessing what it means."""


# ---------------------------------------------------------------------------
# Canonical dtype registry — derived from molrs, not written here
# ---------------------------------------------------------------------------


def _wire_dtype_from_schema(kind: str) -> WireDType | None:
    """Map a molrs schema dtype name onto a wire carrier dtype."""
    if kind == "float":
        return "f64"
    if kind == "uint":
        return "u32"
    if kind == "int":
        return "i32"
    if kind == "string":
        return "string"
    if kind in ("bool", "u8"):
        # No dedicated molrs-wasm setter; widen at the Python boundary.
        return "u32"
    return None


def _canonical_registry() -> dict[str, WireDType]:
    """Map canonical field name → wire dtype from molrs — never hand-copied.

    Prefer :mod:`molrs.schema` (the Frame vocabulary the Validator uses). Fall
    back to :mod:`molrs.fields` only when schema is not yet installed.
    """
    registry: dict[str, WireDType] = {}

    if _schema is not None:
        for spec in getattr(_schema, "columns", ()) or ():
            key = getattr(spec, "key", None)
            kind = getattr(spec, "dtype", None)
            if not isinstance(key, str) or not isinstance(kind, str):
                continue
            wire = _wire_dtype_from_schema(kind)
            if wire is not None:
                registry[key] = wire
        return registry

    for name in _fields.__all__:
        spec = getattr(_fields, name, None)
        if not isinstance(spec, _fields.FieldSpec):
            continue
        kind = spec.dtype.kind
        if kind == "f":
            registry[spec.key] = "f64"
        elif kind in ("i", "u"):
            registry[spec.key] = "i32"
        elif kind in ("U", "S"):
            registry[spec.key] = "string"

    # fields still mis-labels endpoints as signed int on older molrs; the
    # schema path above does not need this override.
    for endpoint in _keys.ENDPOINTS:
        registry[endpoint] = "u32"

    return registry


_CANONICAL: dict[str, WireDType] = _canonical_registry()


def canonical_dtype(key: str) -> WireDType | None:
    """Wire dtype molrs defines for canonical field *key*, or ``None``.

    ``None`` means "not a canonical field" — such a column keeps whatever dtype
    its array already has, exactly like molrs, which lets an unregistered field
    take the dtype of its first write.
    """
    return _CANONICAL.get(key)


# ---------------------------------------------------------------------------
# Column encoding
# ---------------------------------------------------------------------------

_I32_MIN, _I32_MAX = -(2**31), 2**31 - 1
_U32_MAX = 2**32 - 1


def _observed_dtype(array: np.ndarray, key: str) -> WireDType:
    """Wire dtype for a column molrs has no canonical dtype for."""
    kind = array.dtype.kind
    if kind == "f":
        return "f64"
    if kind == "b":
        # molrs-wasm has no bool setter; widen here so the caller can see it.
        return "u32"
    if kind == "u":
        return "u32"
    if kind == "i":
        return "i32"
    if kind in ("U", "S"):
        return "string"
    if kind == "O":
        flat = array.reshape(-1)
        if flat.size == 0 or all(isinstance(v, (str, bytes, bytearray)) for v in flat):
            return "string"
    raise WireError(
        f"column {key!r} has numpy dtype {array.dtype!r}, which has no wire "
        f"representation; convert it to a float, integer, or string column first"
    )


def _cast(array: np.ndarray, dtype: WireDType, key: str) -> np.ndarray | list[str]:
    """Materialize *array* as the carrier the wire dtype names.

    Range violations raise. Silently wrapping a negative index into a huge
    ``u32`` is precisely the corruption the old browser-side coercion caused.
    """
    if dtype == "string":
        return [("" if v is None else str(v)) for v in array.reshape(-1).tolist()]

    flat = np.ascontiguousarray(array.reshape(-1))

    if dtype == "f64":
        return flat.astype(np.float64, copy=False)

    if flat.dtype.kind == "f" and not np.all(np.equal(np.mod(flat, 1), 0)):
        raise WireError(
            f"column {key!r} is an integer column ({dtype}) but holds "
            f"fractional values; it cannot be represented without loss"
        )
    if flat.dtype.kind == "b":
        flat = flat.astype(np.uint32)

    if flat.size:
        low, high = int(flat.min()), int(flat.max())
        if dtype == "u32" and (low < 0 or high > _U32_MAX):
            raise WireError(
                f"column {key!r} must be u32 (molrs stores it unsigned) but "
                f"holds values in [{low}, {high}]"
            )
        if dtype == "i32" and (low < _I32_MIN or high > _I32_MAX):
            raise WireError(
                f"column {key!r} must be i32 but holds values in [{low}, {high}]"
            )

    return flat.astype(np.uint32 if dtype == "u32" else np.int32, copy=False)


def _encode_column(key: str, values: Any) -> tuple[WireDType, np.ndarray | list[str]]:
    """One block column → ``(dtype, carrier)``.

    The dtype is molrs's canonical one when *key* is a canonical field, and the
    array's own otherwise. It is never inferred from the *values*.
    """
    array = np.asarray(values)
    if array.ndim == 0:
        array = array.reshape(1)
    dtype = canonical_dtype(key) or _observed_dtype(array, key)
    return dtype, _cast(array, dtype, key)


# ---------------------------------------------------------------------------
# Frame / Box encoding
# ---------------------------------------------------------------------------


def _frame_mapping(frame: Any) -> dict[str, Any]:
    if isinstance(frame, Mapping):
        return dict(frame)
    to_dict = getattr(frame, "to_dict", None)
    if callable(to_dict):
        return to_dict()
    raise WireError(
        f"expected a Frame with to_dict() or a mapping with 'blocks'; got {type(frame)!r}"
    )



def _validate_frame(frame: Any) -> None:
    """Run molrs schema validation. Never re-check endpoints/dtypes here.

    Real molrs/molpy ``Frame`` objects expose ``validate()``, which delegates to
    ``Validator::canonical``. Raw wire mappings are left alone — building them
    into a Frame would re-implement insert-time rules in this module, and the
    browser side runs the same validator after ``decodeFrame``.
    """
    validate = getattr(frame, "validate", None)
    if not callable(validate):
        return
    try:
        validate()
    except Exception as exc:
        raise WireError(str(exc)) from exc


def encode_frame(
    frame: Any, *, inline: bool = False
) -> tuple[dict[str, Any], list[Any]]:
    """Serialize a Frame for the wire.

    Args:
        frame: A :class:`molpy.Frame`, anything with ``to_dict()``, or a mapping
            shaped like one (``{"blocks": {...}, "metadata": {...}}``).
        inline: When ``True``, numeric columns are left as ndarrays in the
            payload for a transport that can carry them directly (the in-process
            Pyodide bridge). When ``False`` (the WebSocket default) they become
            buffer references into the returned buffer list.

    Returns:
        ``(payload, buffers)``. ``payload`` matches ``WireFrame`` in
        ``core/src/wire.ts``; ``buffers`` is empty when *inline* is ``True*.
    """
    raw = _frame_mapping(frame)
    raw_blocks = raw.get("blocks") or {}
    if not isinstance(raw_blocks, Mapping):
        raise WireError("frame 'blocks' must be a mapping of name → columns")

    # Schema judgment is molrs's job — do not reimplement endpoint/dtype rules.
    _validate_frame(frame if not isinstance(frame, Mapping) else raw)

    buffers: list[Any] = []

    def carrier(value: np.ndarray | list[str], dtype: WireDType) -> Any:
        if dtype == "string" or inline:
            return value
        buffers.append(memoryview(value))  # type: ignore[arg-type]
        return {BUFFER_REF_MARKER: True, "index": len(buffers) - 1}

    blocks: dict[str, Any] = {}
    for raw_name, raw_columns in raw_blocks.items():
        if raw_columns is None:
            continue
        block_name = str(raw_name)
        columns_source = _block_columns(block_name, raw_columns)

        columns: dict[str, Any] = {}
        shape: list[int] | None = None
        for raw_key, raw_value in columns_source.items():
            if raw_value is None:
                continue
            key = str(raw_key)
            array = np.asarray(raw_value)
            if array.ndim > 1:
                shape = [int(n) for n in array.shape]
            dtype, data = _encode_column(key, raw_value)
            columns[key] = {"dtype": dtype, "data": carrier(data, dtype)}

        block: dict[str, Any] = {"columns": columns}
        if shape is not None:
            block["shape"] = shape
        blocks[block_name] = block

    payload: dict[str, Any] = {"blocks": blocks}

    box = raw.get("box") if isinstance(raw, Mapping) else None
    if box is None:
        box = getattr(frame, "box", None)
    if box is not None:
        payload["box"] = encode_box(box, carrier=carrier)

    meta = _scalar_meta(raw.get("meta") if raw.get("meta") is not None else raw.get("metadata"))
    if meta:
        payload["meta"] = meta

    return payload, buffers


def _block_columns(block_name: str, raw_columns: Any) -> Mapping[str, Any]:
    """Accept a mapping of columns, or a Block that behaves like one."""
    if isinstance(raw_columns, Mapping):
        return raw_columns
    to_dict = getattr(raw_columns, "to_dict", None)
    if callable(to_dict):
        result = to_dict()
        if isinstance(result, Mapping):
            return result
    raise WireError(f"block {block_name!r} must be a mapping of column → array")


def _scalar_meta(metadata: Any) -> dict[str, float]:
    """Keep the numeric metadata molrs can store per frame (``setMetaScalar``).

    Accepts both the wire/dict key ``metadata`` and molrs ``Frame.to_dict()``'s
    ``meta`` map (values may be bare numbers or ``molrs.MetaValue``).

    Non-numeric metadata is dropped rather than stringified — the browser has no
    reader for it, and ``str(3.14)`` round-tripping through frame meta is how
    per-frame descriptors used to lose precision.
    """
    if not isinstance(metadata, Mapping):
        return {}
    out: dict[str, float] = {}
    for key, value in metadata.items():
        # molrs.MetaValue carries .value / .dtype
        if hasattr(value, "value") and hasattr(value, "dtype"):
            value = getattr(value, "value", value)
            # Nested F64(...) wrappers expose .value again in some builds.
            if hasattr(value, "value"):
                value = value.value
        if isinstance(value, bool):
            continue
        if isinstance(value, (int, float, np.integer, np.floating)):
            number = float(value)
            if np.isfinite(number):
                out[str(key)] = number
    return out


def encode_box(box: Any, *, carrier: Any = None) -> dict[str, Any]:
    """Serialize a :class:`molpy.Box`.

    ``h`` is ``Box.matrix`` flattened row-major — the matrix whose *columns* are
    the lattice vectors, which is what molrs ``new Box(h, …)`` consumes. The
    array is already C-contiguous, so this is a reshape, not a transpose.
    """
    matrix = np.ascontiguousarray(np.asarray(box.matrix, dtype=np.float64)).reshape(-1)
    if matrix.size != 9:
        raise WireError(f"box matrix must hold 9 values, got {matrix.size}")
    origin = np.ascontiguousarray(np.asarray(box.origin, dtype=np.float64)).reshape(-1)
    if origin.size != 3:
        raise WireError(f"box origin must hold 3 values, got {origin.size}")
    pbc = [bool(flag) for flag in np.asarray(box.pbc).reshape(-1)]
    if len(pbc) != 3:
        raise WireError(f"box pbc must hold 3 flags, got {len(pbc)}")

    if carrier is None:
        return {"h": matrix, "origin": origin, "pbc": pbc}
    return {
        "h": carrier(matrix, "f64"),
        "origin": carrier(origin, "f64"),
        "pbc": pbc,
    }


# ---------------------------------------------------------------------------
# Decoding — wire → molpy
# ---------------------------------------------------------------------------

_NUMPY_BY_DTYPE = {"f64": np.float64, "i32": np.int32, "u32": np.uint32}


def _decode_column(path: str, column: Any, buffers: Sequence[Any]) -> np.ndarray:
    if not isinstance(column, Mapping):
        raise WireError(f"{path}: column must be an object with 'dtype' and 'data'")
    dtype = column.get("dtype")
    data = column.get("data")

    if dtype == "string":
        if not isinstance(data, Sequence) or isinstance(data, (str, bytes)):
            raise WireError(f'{path}: dtype "string" requires a list of strings')
        # A unicode array, not object: molrs rejects object columns outright
        # rather than keeping a Python-side overflow, and it is right to.
        return np.asarray([str(v) for v in data], dtype=np.str_)

    numpy_dtype = _NUMPY_BY_DTYPE.get(dtype) if isinstance(dtype, str) else None
    if numpy_dtype is None:
        raise WireError(f"{path}: unknown dtype {dtype!r}")

    if isinstance(data, Mapping) and data.get(BUFFER_REF_MARKER) is True:
        index = data.get("index")
        if not isinstance(index, int) or not 0 <= index < len(buffers):
            raise WireError(f"{path}: buffer index {index!r} is out of range")
        return np.frombuffer(buffers[index], dtype=numpy_dtype)

    return np.asarray(data, dtype=numpy_dtype).reshape(-1)


def resolve_buffers(payload: Any, buffers: Sequence[Any]) -> Any:
    """Replace every buffer reference in *payload* with its ndarray.

    Applied to an inbound message once, at the transport, so the rest of the
    Python side sees columns whose ``data`` is already an array. Resolution is
    driven by each column's own ``dtype`` tag — the bytes are never interpreted
    by guessing at their content.
    """
    if isinstance(payload, Mapping):
        dtype = payload.get("dtype")
        data = payload.get("data")
        if isinstance(dtype, str) and dtype in _NUMPY_BY_DTYPE:
            if isinstance(data, Mapping) and data.get(BUFFER_REF_MARKER) is True:
                index = data.get("index")
                if not isinstance(index, int) or not 0 <= index < len(buffers):
                    raise WireError(f"buffer index {index!r} is out of range")
                resolved = np.frombuffer(buffers[index], dtype=_NUMPY_BY_DTYPE[dtype])
                return {**payload, "data": resolved}
        return {key: resolve_buffers(value, buffers) for key, value in payload.items()}
    if isinstance(payload, list):
        return [resolve_buffers(item, buffers) for item in payload]
    return payload


def decode_frame(payload: Any, buffers: Sequence[Any] = ()) -> mp.Frame:
    """Rebuild a :class:`molpy.Frame` from a wire payload.

    The inverse of :func:`encode_frame`: every block and every column comes
    back, with the dtype the payload declared.
    """
    if not isinstance(payload, Mapping):
        raise WireError("frame payload must be an object")
    raw_blocks = payload.get("blocks")
    if not isinstance(raw_blocks, Mapping):
        raise WireError("frame payload must include a 'blocks' object")

    blocks: dict[str, Any] = {}
    for raw_name, raw_block in raw_blocks.items():
        block_name = str(raw_name)
        if not isinstance(raw_block, Mapping):
            raise WireError(f"{block_name}: block must be an object")
        raw_columns = raw_block.get("columns")
        if not isinstance(raw_columns, Mapping):
            raise WireError(f"{block_name}: block must include a 'columns' object")
        shape = raw_block.get("shape")

        columns: dict[str, np.ndarray] = {}
        for raw_key, raw_column in raw_columns.items():
            key = str(raw_key)
            array = _decode_column(f"{block_name}.{key}", raw_column, buffers)
            if isinstance(shape, Sequence) and len(shape) > 1:
                array = array.reshape([int(n) for n in shape])
            columns[key] = array
        blocks[block_name] = columns

    frame = mp.Frame(blocks=blocks)

    meta = payload.get("meta")
    if isinstance(meta, Mapping) and meta:
        try:
            from molrs import MetaValue
        except ImportError:
            MetaValue = None  # type: ignore[misc, assignment]
        if MetaValue is not None and hasattr(frame, "meta"):
            frame.meta = {
                str(k): MetaValue("f64", float(v)) for k, v in meta.items()
            }
        elif hasattr(frame, "metadata"):
            frame.metadata.update({str(k): float(v) for k, v in meta.items()})

    box = payload.get("box")
    if box is not None:
        frame.box = decode_box(box, buffers)

    _validate_frame(frame)
    return frame


def decode_box(payload: Any, buffers: Sequence[Any] = ()) -> mp.Box:
    """Rebuild a :class:`molpy.Box`. ``h`` is read row-major (see :func:`encode_box`)."""
    if not isinstance(payload, Mapping):
        raise WireError("box payload must be an object")
    h = _decode_column("box.h", {"dtype": "f64", "data": payload.get("h")}, buffers)
    origin = _decode_column(
        "box.origin", {"dtype": "f64", "data": payload.get("origin")}, buffers
    )
    if h.size != 9:
        raise WireError(f"box.h must hold 9 values, got {h.size}")
    if origin.size != 3:
        raise WireError(f"box.origin must hold 3 values, got {origin.size}")
    pbc = payload.get("pbc")
    if not isinstance(pbc, Sequence) or len(pbc) != 3:
        raise WireError("box.pbc must be three booleans")
    # molpy.Box(matrix, pbc, origin) — matrix has lattice vectors as columns,
    # so the row-major wire array reshapes straight into it.
    return mp.Box(
        h.reshape(3, 3),
        np.asarray([bool(flag) for flag in pbc]),
        origin,
    )
