from runtime_app.prompt_loader import load_prompt, resolve_prompt_path


def test_prompt_loader_prefers_markdown_files() -> None:
    path = resolve_prompt_path("chat_turn.system.md")
    assert path.name == "chat_turn.system.md"


def test_prompt_loader_keeps_legacy_txt_lookups_working() -> None:
    path = resolve_prompt_path("chat_turn.system.txt")
    assert path.name == "chat_turn.system.md"
    assert "voice-native assistant" in load_prompt("chat_turn.system.txt")
