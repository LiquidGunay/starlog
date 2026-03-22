#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import sys

import uvicorn

RUNTIME_ROOT = Path(__file__).resolve().parents[1] / "services" / "ai-runtime"
if str(RUNTIME_ROOT) not in sys.path:
    sys.path.insert(0, str(RUNTIME_ROOT))

from bridge.local_stt_server import app, load_local_stt_config


def main() -> None:
    config = load_local_stt_config()
    uvicorn.run(app, host=config.host, port=config.port)


if __name__ == "__main__":
    main()
