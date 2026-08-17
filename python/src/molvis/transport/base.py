"""Transport protocol for Python-to-frontend communication."""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class Transport(Protocol):
    """
    Protocol for sending JSON-RPC commands to the MolVis frontend.

    Concrete implementations:

    - :class:`~molvis.transport.WebSocketTransport` — local WS server
    - :class:`~molvis.transport.InProcessTransport` — in-page RPCRouter

    Command mixins depend only on this Protocol so test fakes can be
    swapped in freely.
    """

    def send_request(
        self,
        method: str,
        params: dict[str, Any],
        *,
        buffers: list[Any] | None = None,
        wait_for_response: bool = False,
        timeout: float = 5.0,
    ) -> dict[str, Any] | None:
        """Send a JSON-RPC request to the frontend.

        Args:
            method: RPC method name.
            params: Method parameters (will be binary-encoded).
            buffers: Optional extra binary buffers.
            wait_for_response: If True, block until the response arrives.
            timeout: Maximum seconds to wait for a response.

        Returns:
            The JSON-RPC response dict if *wait_for_response* is True,
            otherwise None.
        """
        ...
