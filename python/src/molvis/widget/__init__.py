import pathlib
from anywidget.experimental import widget, MimeBundleDescriptor
from dataclasses import dataclass
import psygnal

from molvis.rpc import JsonPRCResponse, JsonRPCRequest

import random

esm=pathlib.Path(__file__).parent / "static" / "widget.js"
css=pathlib.Path(__file__).parent / "static" / "widget.css"

@widget(esm=esm, css=css)
@psygnal.evented
@dataclass
class MolvisWidget:
    response_: JsonPRCResponse = None
    request_: JsonRPCRequest | None = None

    def request(self, method:str, **params:dict):
        self.request_ = JsonRPCRequest(id=str(random.randint(0, 9999)), method=method, params=params)