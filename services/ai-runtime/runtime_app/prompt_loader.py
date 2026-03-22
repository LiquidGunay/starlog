from __future__ import annotations

import json
from pathlib import Path

PROMPTS_ROOT = Path(__file__).resolve().parents[1] / "prompts"


class _SafePromptDict(dict[str, object]):
    def __missing__(self, key: str) -> str:
        return ""


def load_prompt(name: str) -> str:
    path = PROMPTS_ROOT / name
    return path.read_text(encoding="utf-8").strip()


def _format_prompt_value(value: object) -> object:
    if isinstance(value, (dict, list)):
        return json.dumps(value, indent=2, sort_keys=True)
    return value


def render_prompt(name: str, **kwargs: object) -> str:
    rendered_kwargs = {key: _format_prompt_value(value) for key, value in kwargs.items()}
    return load_prompt(name).format_map(_SafePromptDict(rendered_kwargs))
