#!/usr/bin/env bash
# Runs a bridge skill through headless Claude Code (your subscription).
# Usage: echo "some text" | bridge/bin/run-skill.sh <skill>
set -euo pipefail

skill="${1:?usage: run-skill.sh <skill> < input}"
[[ "$skill" =~ ^[a-z0-9-]+$ ]] || { echo "invalid skill name: $skill" >&2; exit 2; }

bridge_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
skill_dir="$bridge_dir/.claude/skills/$skill"
[[ -f "$skill_dir/SKILL.md" ]] || { echo "unknown skill: $skill" >&2; exit 2; }

# Project skills resolve relative to the working directory.
cd "$bridge_dir"

args=(-p "/$skill" --tools "" --output-format json --no-session-persistence)
if [[ -f "$skill_dir/schema.json" ]]; then
  args+=(--json-schema "$(cat "$skill_dir/schema.json")")
fi

# exec so the server's kill() reaches claude itself.
exec claude "${args[@]}"
