#!/usr/bin/env python3
"""Enable, launch, or remove the Codex Sol agent-tree workflow for Pi."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


ROUTES = {
    "scout": {"model": "openai-codex/gpt-6-luna", "thinking": "high"},
    # The built-in researcher asks for web tools that no installed extension provides, so it fails to launch.
    "researcher": {"model": "openai-codex/gpt-6-luna", "thinking": "high",
                   "tools": ["read", "write", "grep", "find", "ls", "bash"]},
    "worker": {"model": "openai-codex/gpt-6.1-sol", "thinking": "high"},
    "reviewer": {"model": "openai-codex/gpt-6-astra", "thinking": "low"},
}
SECTION_BEGIN = b"<!-- codex-sol:begin (managed by scripts/codex-sol.py; remove with `codex-sol.py restore`) -->\n"
SECTION_END = b"<!-- codex-sol:end -->\n"
USAGE = "Usage: codex-sol.py enable | start [pi arguments...] | restore | status"


def agent_file(name):
    agent_dir = Path(os.environ.get("PI_CODING_AGENT_DIR", Path.home() / ".pi" / "agent"))
    return (agent_dir / name).resolve()


def save(path, content):
    # Replace the symlink target, not the symlink under ~/.pi/agent.
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".codex-sol-", delete=False) as temporary:
            temporary_path = Path(temporary.name)
            temporary.write(content)
        os.chmod(temporary_path, path.stat().st_mode & 0o777 if path.exists() else 0o644)
        os.replace(temporary_path, path)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def save_settings(path, settings):
    content = json.dumps(settings, indent=2, ensure_ascii=False).encode("utf-8")
    if path.read_bytes().endswith(b"\n"):
        content += b"\n"
    save(path, content)


def policy_section():
    policy = Path(__file__).with_name("codex-sol-policy.md").read_bytes().replace(b"\r\n", b"\n")
    return b"\n" + SECTION_BEGIN + policy.strip() + b"\n" + SECTION_END


def section_span(prompt):
    """Return (start, end) of the managed section, None if absent, or False if the markers are damaged."""
    begin_count, end_count = prompt.count(SECTION_BEGIN), prompt.count(SECTION_END)
    if begin_count == 0 and end_count == 0:
        return None
    start = prompt.find(SECTION_BEGIN)
    end = prompt.find(SECTION_END, start)
    if begin_count != 1 or end_count != 1 or end < 0:
        return False
    if prompt[:start].endswith(b"\n"):
        start -= 1  # the separator newline added by policy_section()
    return start, end + len(SECTION_END)


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("enable", "start", "restore", "status"):
        print(USAGE, file=sys.stderr)
        return 2
    action = sys.argv[1]
    settings_path = agent_file("settings.json")
    prompt_path = agent_file("APPEND_SYSTEM.md")
    try:
        settings = json.loads(settings_path.read_text(encoding="utf-8"))
        prompt = prompt_path.read_bytes() if prompt_path.exists() else b""
    except (OSError, ValueError) as error:
        print(f"Cannot read Pi settings: {error}", file=sys.stderr)
        return 1
    if not isinstance(settings, dict) or not isinstance(settings.get("subagents", {}), dict) or not isinstance(
            settings.get("subagents", {}).get("agentOverridesByProvider", {}), dict):
        print("Pi settings have an unexpected shape; refusing to change them.", file=sys.stderr)
        return 1
    providers = settings.get("subagents", {}).get("agentOverridesByProvider", {})
    current = providers.get("openai-codex")
    span = section_span(prompt)

    if action == "status":
        routes = "enabled" if current == ROUTES else "disabled" if current is None else "modified (manual review required)"
        policy = "disabled" if span is None else "damaged markers (manual review required)" if span is False else (
            "enabled" if prompt[span[0]:span[1]] == policy_section() else "enabled (text edited)")
        print(f"Codex Sol routing: {routes}")
        print(f"Codex Sol policy in APPEND_SYSTEM.md: {policy}")
        return 0

    if current is not None and current != ROUTES:
        print("Codex routing was modified; refusing to overwrite it.", file=sys.stderr)
        return 1
    if span is False:
        print("Codex Sol markers in APPEND_SYSTEM.md are damaged; refusing to change it.", file=sys.stderr)
        return 1

    if action == "restore":
        if span is not None:
            save(prompt_path, prompt[:span[0]] + prompt[span[1]:])
        if current is not None:
            del providers["openai-codex"]
            save_settings(settings_path, settings)
        print("Codex Sol routing and policy removed. Existing sessions remain unchanged; "
              "new Pi sessions use your previous setup.")
        return 0

    executable = shutil.which("pi")
    if action == "start" and executable is None:
        print("Pi was not found on PATH; no session started.", file=sys.stderr)
        return 1
    if span is None:
        save(prompt_path, prompt + policy_section())
    if current is None:
        settings.setdefault("subagents", {}).setdefault("agentOverridesByProvider", {})["openai-codex"] = ROUTES
        save_settings(settings_path, settings)
    if action == "enable":
        print("Codex Sol routing and policy enabled for every Pi session on openai-codex.")
        return 0

    # No --append-system-prompt here: that flag makes Pi skip APPEND_SYSTEM.md, which now carries the policy.
    command = [executable, "--provider", "openai-codex", "--model", "gpt-6.1-sol",
               "--thinking", "medium", *sys.argv[2:]]
    return subprocess.call(command)


if __name__ == "__main__":
    sys.exit(main())
