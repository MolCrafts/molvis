import importlib.metadata
import pathlib

import anywidget
import traitlets
from anywidget.experimental import widget
from dataclasses import dataclass
import psygnal

try:
    __version__ = importlib.metadata.version("widget")
except importlib.metadata.PackageNotFoundError:
    __version__ = "unknown"


class Operation(traitlets.HasTraits):
    target = traitlets.Unicode()
    method = traitlets.Unicode()
    args = traitlets.Dict()


# class Widget(anywidget.AnyWidget):
#     _esm = pathlib.Path(__file__).parent / "static" / "widget.js"
#     _css = pathlib.Path(__file__).parent / "static" / "widget.css"
#     operation = Operation().tag(sync=True)

#     def add_atom(self, x, y, z):
#         Widget.operation = Operation(target="system.frame", method="add_atom", args={"x": x, "y": y, "z": z})


@widget(
    esm=pathlib.Path(__file__).parent / "static" / "widget.js",
    css=pathlib.Path(__file__).parent / "static" / "widget.css",
)
@psygnal.evented
@dataclass
class MolvisWidget:
    target: str
    method: str
    kwargs: dict

    def __init__(self):
        self.target = ""
        self.method = ""
        self.kwargs = {}

    def do(self, target, method, **kwargs):
        self.target = target
        self.method = method
        self.kwargs = kwargs