import pathlib
from anywidget.experimental import widget
import psygnal

from molvis.rpc import JsonRPCRequest, JsonPRCResponse

@widget(
    esm=pathlib.Path(__file__).parent / "static" / "widget.js",
    css=pathlib.Path(__file__).parent / "static" / "widget.css",
)
class MolvisWidget:

    def __init__(self):
        self._request = psygnal.evented(JsonRPCRequest)
        self._response = psygnal.evented(JsonPRCResponse)

    def request(self, id:int, method:str, params:dict = {}):
        
        self._request(id=id, method=method, params=params)