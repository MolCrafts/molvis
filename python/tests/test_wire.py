"""Wire-format contract: dtypes come from molrs, never from the values."""

from __future__ import annotations

import molpy as mp
import numpy as np
import pytest
from molrs import keys

from molvis.wire import (
    BUFFER_REF_MARKER,
    WireError,
    canonical_dtype,
    decode_box,
    decode_frame,
    encode_box,
    encode_frame,
)


def roundtrip(frame):
    payload, buffers = encode_frame(frame)
    return decode_frame(payload, [bytes(b) for b in buffers])


class TestCanonicalDtype:
    def test_reads_coordinates_as_float_from_the_molrs_registry(self):
        for key in keys.COORDS:
            assert canonical_dtype(key) == "f64"

    def test_reads_relation_endpoints_as_unsigned(self):
        # molrs::store::keys calls these "the UInt relation endpoints", and the
        # whole renderer reads them with viewColU32.
        for key in keys.ENDPOINTS:
            assert canonical_dtype(key) == "u32"

    def test_reads_labels_as_strings(self):
        assert canonical_dtype(keys.ELEMENT) == "string"
        # `type` is the force-field label; element is the IUPAC symbol.
        assert canonical_dtype(keys.TYPE) == "string"
        # symbol may be absent on older key tables; only assert when present.
        symbol = getattr(keys, "SYMBOL", None)
        if symbol is not None:
            assert canonical_dtype(symbol) == "string"

    def test_unregistered_field_has_no_canonical_dtype(self):
        # Matches molrs: a field not in the registry takes the dtype of its
        # first write rather than being coerced.
        assert canonical_dtype("my_custom_descriptor") is None


class TestEncodeFrame:
    def test_whole_number_coordinates_stay_float(self):
        # The regression the wire format exists to kill: these used to be
        # sniffed as u32 in the browser and the atoms vanished.
        payload, _ = encode_frame(
            mp.Frame(blocks={"atoms": {"x": [0, 0, 0], "y": [0, 1, 2], "z": [0, 0, 0]}})
        )
        columns = payload["blocks"]["atoms"]["columns"]
        assert {columns[axis]["dtype"] for axis in ("x", "y", "z")} == {"f64"}

    def test_bond_endpoints_are_u32_whatever_numpy_they_arrived_as(self):
        # A raw mapping, not a Frame: molrs's Block rejects exotic integer
        # widths at construction, so this is the only way a caller can hand us
        # an int64/uint64 endpoint column.
        payload, _ = encode_frame(
            {
                "blocks": {
                    "bonds": {
                        "atomi": np.array([0, 1], dtype=np.int64),
                        "atomj": np.array([1, 2], dtype=np.uint64),
                        "atomk": [2, 3],
                    }
                }
            }
        )
        columns = payload["blocks"]["bonds"]["columns"]
        assert {column["dtype"] for column in columns.values()} == {"u32"}

    def test_emits_every_block_and_column(self):
        payload, _ = encode_frame(
            mp.Frame(
                blocks={
                    "atoms": {"x": [0.0], "charge": [-0.5], "mol_id": [3]},
                    "residues": {"res_name": ["ALA"]},
                }
            )
        )
        assert set(payload["blocks"]) == {"atoms", "residues"}
        assert set(payload["blocks"]["atoms"]["columns"]) == {"x", "charge", "mol_id"}

    def test_numeric_columns_become_buffer_references(self):
        payload, buffers = encode_frame(
            mp.Frame(blocks={"atoms": {"x": [1.0, 2.0], "element": ["C", "O"]}})
        )
        columns = payload["blocks"]["atoms"]["columns"]
        assert columns["x"]["data"][BUFFER_REF_MARKER] is True
        assert len(buffers) == 1
        # Strings have no TypedArray, so they ride inline.
        assert columns["element"]["data"] == ["C", "O"]

    def test_inline_mode_keeps_arrays_for_the_in_process_transport(self):
        payload, buffers = encode_frame(
            mp.Frame(blocks={"atoms": {"x": [1.0, 2.0]}}), inline=True
        )
        assert buffers == []
        data = payload["blocks"]["atoms"]["columns"]["x"]["data"]
        assert isinstance(data, np.ndarray)
        assert data.dtype == np.float64


class TestEncodeFrameRejectsLossyValues:
    def test_negative_endpoint_raises_instead_of_wrapping(self):
        # A raw mapping can still carry a negative before molrs sees it; the
        # wire cast must refuse rather than wrap into a huge u32. Constructing
        # a real Frame already rejects this at schema-adopt time.
        with pytest.raises(WireError, match=r"atomi.*u32"):
            encode_frame({"blocks": {"bonds": {"atomi": [-1], "atomj": [0]}}})

    def test_fractional_value_in_an_integer_field_raises(self):
        # `id` is uint in the Frame schema; a fractional value cannot cast.
        with pytest.raises(WireError, match="fractional|u32|uint"):
            encode_frame({"blocks": {"atoms": {"id": [1.5]}}})

    def test_out_of_range_integer_id_raises(self):
        # Schema (new molrs) declares `id` as uint; older fields tables used i32.
        # Either way the wire must refuse a value that does not fit the carrier.
        with pytest.raises(WireError, match=r"u32|i32"):
            encode_frame({"blocks": {"atoms": {"id": [2**40]}}})


class TestEncodeFrameNaming:
    def test_never_renames_a_column(self):
        # `symbol` and `element` are distinct fields in molrs keys.rs; the old
        # browser decoder collapsed one into the other.
        payload, _ = encode_frame(
            {"blocks": {"atoms": {"symbol": ["Fe1"], "element": ["Fe"]}}}
        )
        assert set(payload["blocks"]["atoms"]["columns"]) == {"symbol", "element"}

    def test_never_requires_a_column(self):
        # No x/y/z, no element — a caller may send whatever blocks it has.
        payload, _ = encode_frame({"blocks": {"atoms": {"charge": [0.1, 0.2]}}})
        assert set(payload["blocks"]["atoms"]["columns"]) == {"charge"}


class TestRoundTrip:
    def test_preserves_dtypes_and_values(self):
        frame = roundtrip(
            mp.Frame(
                blocks={
                    "atoms": {
                        "x": [0.0, 1.5],
                        "element": ["C", "O"],
                        "charge": [-0.5, 0.5],
                    },
                    "bonds": {"atomi": [0], "atomj": [1], "order": [2]},
                }
            )
        )
        blocks = frame.to_dict()["blocks"]
        assert blocks["atoms"]["x"].dtype == np.float64
        assert blocks["atoms"]["x"].tolist() == [0.0, 1.5]
        assert blocks["atoms"]["element"].tolist() == ["C", "O"]
        assert blocks["bonds"]["atomi"].dtype == np.uint32
        assert blocks["bonds"]["order"].tolist() == [2.0]

    def test_preserves_a_custom_block_and_column(self):
        frame = roundtrip({"blocks": {"forces": {"fx": [1.0], "fy": [2.0]}}})
        assert set(frame.to_dict()["blocks"]["forces"]) == {"fx", "fy"}

    def test_preserves_numeric_frame_metadata_without_stringifying(self):
        payload, buffers = encode_frame(
            {"blocks": {"atoms": {"x": [0.0]}}, "metadata": {"energy": -12.25}}
        )
        assert payload["meta"] == {"energy": -12.25}
        frame = decode_frame(payload, [bytes(b) for b in buffers])
        # molrs Frame exposes typed meta; older builds used .metadata.
        meta = getattr(frame, "meta", None) or getattr(frame, "metadata", {})
        energy = meta["energy"]
        if hasattr(energy, "value"):
            energy = energy.value
            if hasattr(energy, "value"):
                energy = energy.value
        assert float(energy) == pytest.approx(-12.25)

    def test_drops_non_numeric_metadata_rather_than_stringifying_it(self):
        # molrs-wasm can only read scalars back, so a string label would be a
        # one-way trip that silently looks like it round-tripped.
        payload, _ = encode_frame(
            {"blocks": {"atoms": {"x": [0.0]}}, "metadata": {"note": "run-42"}}
        )
        assert "meta" not in payload




class TestMolrsSchemaValidation:
    """Requires molrs Frame schema (Validator). Skip on older molrs builds."""

    @staticmethod
    def _schema_ready() -> bool:
        try:
            from molrs import schema  # type: ignore

            return schema.column("atomi") is not None
        except Exception:
            return False

    def test_bond_endpoint_out_of_range_uses_molrs_validator(self):
        if not self._schema_ready():
            pytest.skip("molrs schema Validator not available")
        # The report text comes from molrs Validator — we only wrap it.
        with pytest.raises(WireError, match=r"atomi|out of range"):
            encode_frame(
                mp.Frame(
                    blocks={
                        "atoms": {"x": [0.0]},
                        "bonds": {"atomi": [5], "atomj": [0]},
                    }
                )
            )

    def test_missing_required_bond_endpoints_uses_molrs_validator(self):
        if not self._schema_ready():
            pytest.skip("molrs schema Validator not available")
        with pytest.raises(WireError, match=r"required column|atomi"):
            encode_frame(mp.Frame(blocks={"bonds": {"order": [1.0]}}))


class TestBox:
    def test_round_trips_a_triclinic_cell(self):
        box = mp.Box.tric([10.0, 20.0, 30.0], [1.0, 2.0, 3.0])
        restored = decode_box(encode_box(box))
        assert np.allclose(np.asarray(restored.lengths), np.asarray(box.lengths))
        assert np.allclose(np.asarray(restored.tilts), np.asarray(box.tilts))

    def test_h_is_the_row_major_flattening_of_the_lattice_matrix(self):
        # molpy documents Box.matrix as "lattice vectors as columns"; the wire
        # carries that matrix row-major, which is what molrs new Box() expects.
        box = mp.Box.tric([10.0, 20.0, 30.0], [1.0, 2.0, 3.0])
        assert np.allclose(
            encode_box(box)["h"], np.asarray(box.matrix).reshape(-1, order="C")
        )

    def test_pbc_survives(self):
        box = mp.Box(np.eye(3) * 10, np.asarray([True, False, True]))
        restored = decode_box(encode_box(box))
        assert np.asarray(restored.pbc).tolist() == [True, False, True]

    def test_frame_carries_its_own_box(self):
        frame = mp.Frame(blocks={"atoms": {"x": [0.0]}})
        frame.box = mp.Box.cube(10.0)
        assert roundtrip(frame).box is not None


class TestDecodeRejectsBadPayloads:
    def test_unknown_dtype_tag(self):
        with pytest.raises(WireError, match="unknown dtype"):
            decode_frame(
                {"blocks": {"atoms": {"columns": {"x": {"dtype": "f32", "data": [0]}}}}}
            )

    def test_dangling_buffer_reference(self):
        with pytest.raises(WireError, match="out of range"):
            decode_frame(
                {
                    "blocks": {
                        "atoms": {
                            "columns": {
                                "x": {
                                    "dtype": "f64",
                                    "data": {BUFFER_REF_MARKER: True, "index": 7},
                                }
                            }
                        }
                    }
                }
            )

    def test_missing_blocks(self):
        with pytest.raises(WireError, match="blocks"):
            decode_frame({})
