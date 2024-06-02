from dataclasses import dataclass

@dataclass
class JsonRPCRequest:

    id: int
    method: str
    params: dict
    jsonrpc: str = "2.0"
    is_notification: bool = False

@dataclass
class JsonError:

    code: int
    message: str
    data: dict | None

@dataclass
class JsonPRCResponse:

    id: int
    result: dict | None
    error: JsonError | None
    jsonrpc: str = "2.0"


# TODO: batch
