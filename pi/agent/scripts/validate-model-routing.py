#!/usr/bin/env python3
"""Reject model IDs that bypass the configured subscription/provider policy."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

DEFAULT_ROOTS = [Path.home() / ".pi/agent", Path.home() / ".agents"]
SKIP_PARTS = {
    ".git",
    ".removed-imported-skills-2026-06-02-090722",
    "artifacts",
    "node_modules",
    "reports",
    "runs",
    "sessions",
}
TEXT_SUFFIXES = {".json", ".md", ".mjs", ".js", ".ts", ".yaml", ".yml"}

# Build forbidden strings in pieces so this validator does not flag itself.
FORBIDDEN = [
    ("bare DeepSeek ID", re.compile(r"(?<!openrouter/)" + "deepseek/" + r"deepseek-[A-Za-z0-9_.:-]+")),
    ("GPT routed through OpenRouter", re.compile("openrouter/" + "openai/" + r"[A-Za-z0-9_./:-]+")),
    ("Claude routed through OpenRouter", re.compile("openrouter/" + "anthropic/" + r"[A-Za-z0-9_./:-]+")),
]


def should_scan(path: Path) -> bool:
    return (
        path.is_file()
        and path.suffix.lower() in TEXT_SUFFIXES
        and not any(part in SKIP_PARTS for part in path.parts)
        and path.stat().st_size <= 2_000_000
    )


def validate(roots: list[Path]) -> list[tuple[Path, int, str, str]]:
    violations: list[tuple[Path, int, str, str]] = []
    for root in roots:
        if not root.exists():
            continue
        candidates = [root] if root.is_file() else root.rglob("*")
        for path in candidates:
            try:
                if not should_scan(path):
                    continue
                lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
            except OSError:
                continue
            for line_number, line in enumerate(lines, 1):
                for label, pattern in FORBIDDEN:
                    match = pattern.search(line)
                    if match:
                        violations.append((path, line_number, label, match.group(0)))
    return violations


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate canonical model routing: DeepSeek via OpenRouter, GPT via Codex, Claude/Fable via Claude CLI."
    )
    parser.add_argument("paths", nargs="*", help="Optional files/directories; defaults to ~/.pi/agent and ~/.agents")
    args = parser.parse_args()
    roots = [Path(value).expanduser().resolve() for value in args.paths] if args.paths else DEFAULT_ROOTS
    violations = validate(roots)
    if violations:
        print("Model-routing validation failed:", file=sys.stderr)
        for path, line, label, value in violations:
            print(f"  {path}:{line}: {label}: {value}", file=sys.stderr)
        print("\nCanonical policy: DeepSeek=openrouter/deepseek/*; GPT=openai-codex/*; Claude/Fable=Claude CLI only.", file=sys.stderr)
        return 1
    print(f"Model-routing validation passed ({len(roots)} root(s)).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
