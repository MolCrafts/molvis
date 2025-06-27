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

    def __init__(self, width=800, height=600, reload: bool = False, **kwargs):
        super().__init__(**kwargs)
        self.width = width
        self.height = height

        if reload:
            # Force reload of the frontend
            self._esm = ESM_path.read_text()
            logger.info("Reloaded ESM from disk")

    def send_cmd(self, method: str, params: dict, buffers: list | None = None) -> "Molvis":
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
                # Use JSON - extract and convert xarray format to simple format
                frame_dict = frame.to_dict()
                # Extract atoms data from xarray format
                atoms_data = None
                if 'data' in frame_dict and 'atoms' in frame_dict['data']:
                    atoms_vars = frame_dict['data']['atoms'].get('data_vars', {})
                    if atoms_vars:
                        atoms_data = {}
                        # Extract coordinates from xyz
                        if 'xyz' in atoms_vars:
                            xyz_data = atoms_vars['xyz']['data']
                            atoms_data['x'] = [coord[0] for coord in xyz_data]
                            atoms_data['y'] = [coord[1] for coord in xyz_data]
                            atoms_data['z'] = [coord[2] for coord in xyz_data]
                        
                        # Extract other atom properties
                        for key in ["id", 'name', 'element', 'type']:
                            if key in atoms_vars:
                                atoms_data[key] = atoms_vars[key]['data']
                
                # Extract bonds data from xarray format
                bonds_data = None
                if 'data' in frame_dict and 'bonds' in frame_dict['data']:
                    bonds_vars = frame_dict['data']['bonds'].get('data_vars', {})
                    if bonds_vars and 'i' in bonds_vars and 'j' in bonds_vars:
                        bonds_data = {
                            'i': bonds_vars['i']['data'],
                            'j': bonds_vars['j']['data']
                        }
                        # Add order if available
                        if 'order' in bonds_vars:
                            bonds_data['order'] = bonds_vars['order']['data']
                
                # Extract box data
                box_data = frame_dict.get('box')
                
                # Create simplified frame data for TypeScript
                simple_frame_data = {}
                if atoms_data:
                    simple_frame_data['atoms'] = atoms_data
                if bonds_data:
                    simple_frame_data['bonds'] = bonds_data
                if box_data:
                    simple_frame_data['box'] = box_data
                
                # Debug output
                logger.info(f"Extracted frame data: atoms={bool(atoms_data)}, bonds={bool(bonds_data)}, box={bool(box_data)}")
                if atoms_data:
                    logger.info(f"Atoms: {len(atoms_data.get('x', []))} atoms with keys {list(atoms_data.keys())}")
                if bonds_data:
                    logger.info(f"Bonds: {len(bonds_data.get('i', []))} bonds")
                
                params = {
                    "frameData": simple_frame_data,
                    "options": {
                        "atoms": {"radius": 0.5},
                        "bonds": {"radius": 0.1},
                        "box": {"visible": True},
                        "clean": True
                    }
                }
                
                # Use draw_python_frame command
                self.send_cmd("draw_python_frame", params, [])
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

    def set_camera(self, position: list | None = None, target: list | None = None) -> "Molvis":
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
