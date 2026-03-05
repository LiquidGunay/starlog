import logging
import uuid
from collections.abc import Awaitable, Callable

from fastapi import Request
from fastapi.responses import Response

logger = logging.getLogger("starlog.request")


async def request_id_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
    request.state.request_id = request_id

    logger.info(
        "request.start",
        extra={
            "request_id": request_id,
            "extra_payload": {
                "method": request.method,
                "path": request.url.path,
            },
        },
    )

    response = await call_next(request)
    response.headers["x-request-id"] = request_id

    logger.info(
        "request.end",
        extra={
            "request_id": request_id,
            "extra_payload": {
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
            },
        },
    )

    return response
