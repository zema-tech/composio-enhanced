"""
Helper Python per sessioni Composio più robuste.
"""

from __future__ import annotations

import time
from typing import Any, Callable, Optional, Sequence


def create_session_with_retry(
    composio: Any,
    user_id: str,
    *,
    toolkits: Optional[Sequence[str]] = None,
    mcp: bool = False,
    max_retries: int = 3,
    base_delay: float = 0.4,
) -> Any:
    """Crea una sessione con retry su errori transienti (429 / 5xx)."""
    last_error: Exception | None = None

    for attempt in range(max_retries):
        try:
            kwargs: dict[str, Any] = {}
            if toolkits is not None:
                kwargs["toolkits"] = list(toolkits)
            if mcp:
                kwargs["mcp"] = True
            return composio.create(user_id=user_id, **kwargs)
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            status = getattr(exc, "status", None) or getattr(
                getattr(exc, "response", None), "status_code", None
            )
            if status in (429,) or (isinstance(status, int) and 500 <= status < 600):
                time.sleep(base_delay * (2 ** attempt))
                continue
            raise

    assert last_error is not None
    raise last_error


def use_session_safe(composio: Any, session_id: str) -> Any:
    if not session_id:
        raise ValueError("session_id is required")
    return composio.use(session_id)
