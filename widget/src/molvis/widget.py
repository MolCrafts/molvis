import pathlib
import anywidget
import traitlets
import logging
import json
import molpy as mp
from .types import JsonRPCRequest
import random
from dataclasses import asdict

logger = logging.getLogger("molvis")

__version__ = "0.1.0"

bundled_assets_dir = pathlib.Path("/workspaces/molvis/widget/dist")
ESM_path = bundled_assets_dir / "index.js"
assert ESM_path.exists(), f"{ESM_path} not found"
ESM = ESM_path.read_text()


class Molvis(anywidget.AnyWidget):
    """A widget for molecular visualization using molpy and anywidget."""

    _esm = ESM
    width = traitlets.Int(800).tag(sync=True)
    height = traitlets.Int(600).tag(sync=True)
    session_id = traitlets.Int(random.randint(0, 99999)).tag(sync=True)

    def __init__(self, **kwargs):
        super().__init__(**kwargs)

    def send_cmd(self, method: str, params: dict, buffers: list = None) -> "Molvis":
        """Send a command to the frontend."""
        if buffers is None:
            buffers = []
        jsonrpc = JsonRPCRequest(
            jsonrpc="2.0",
            method=method,
            params=params,
            id=self.session_id,
        )
        self.send(json.dumps(asdict(jsonrpc)), buffers=buffers)
        return self

    def draw_atom(self, name, x, y, z, element=None):
        """Draw a single atom."""
        atom_data = {
            "name": name,
            "x": x,
            "y": y,
            "z": z,
            "element": element,
        }
        self.send_cmd("draw_atom", atom_data, [])
        return self

    def draw_bond(self, i, j, order=1, **kwargs):
        """Draw a single bond between atom i and j."""
        bond_data = {
            "i": i,
            "j": j,
            "order": order,
            **kwargs,
        }
        self.send_cmd("draw_bond", bond_data, [])
        return self

    def draw_frame(self, frame: mp.Frame, compression: str = 'gzip') -> "Molvis":
        """Draw a molecular frame: <2048 atoms use JSON, otherwise use HDF5 bytes."""
        n_atoms = frame._meta.get("n_atoms", 0)
        try:
            if n_atoms < 2048:
                # Use JSON directly in params
                frame_dict = frame.to_dict()
                params = {
                    "format": "json",
                    "data": frame_dict,
                    "metadata": {
                        "structure_name": frame._meta.get("structure_name", ""),
                        "n_atoms": n_atoms,
                        "n_bonds": frame._meta.get("n_bonds", 0)
                    }
                }
                self.send_cmd("draw_frame", params, [])
                logger.info(f"Sent JSON frame: {n_atoms} atoms")
            else:
                # Use HDF5 bytes
                hdf5_bytes = frame.to_hdf5_bytes(compression=compression)
                params = {
                    "format": "hdf5",
                    "compression": compression,
                    "data": "__buffer.0",
                    "metadata": {
                        "structure_name": frame._meta.get("structure_name", ""),
                        "n_atoms": n_atoms,
                        "n_bonds": frame._meta.get("n_bonds", 0),
                        "data_size": len(hdf5_bytes)
                    }
                }
                self.send_cmd("draw_frame", params, [hdf5_bytes])
                logger.info(f"Sent HDF5 frame: {n_atoms} atoms, {len(hdf5_bytes)} bytes")
        except Exception as e:
            logger.error(f"Failed to send frame: {e}")
        return self

    def clear(self) -> "Molvis":
        """Clear the visualization."""
        self.send_cmd("clear", {}, [])
        return self

    def set_camera(self, position: list = None, target: list = None) -> "Molvis":
        """Set camera position and target."""
        params = {}
        if position:
            params["position"] = position
        if target:
            params["target"] = target
        self.send_cmd("set_camera", params, [])
        return self

    def set_style(self, style: str = "ball_and_stick") -> "Molvis":
        """Set visualization style."""
        params = {"style": style}
        self.send_cmd("set_style", params, [])
        return self
