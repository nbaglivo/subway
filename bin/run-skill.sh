#!/usr/bin/env bash
# Runs a bridge skill through headless Claude Code (your subscription).
# Usage: echo "some text" | bridge/bin/run-skill.sh <skill>
set -euo pipefail

skill="${1:?usage: run-skill.sh <skill> < input}"
[[ "$skill" =~ ^[a-z0-9-]+$ ]] || { echo "invalid skill name: $skill" >&2; exit 2; }

bridge_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
skill_dir="$bridge_dir/.claude/skills/$skill"
[[ -f "$skill_dir/SKILL.md" ]] || { echo "unknown skill: $skill" >&2; exit 2; }

# SKILL.md minus its frontmatter becomes the whole system prompt.
system_prompt="$(awk 'NR == 1 && $0 == "---" { fm = 1; next } fm && $0 == "---" { fm = 0; next } !fm' "$skill_dir/SKILL.md")"

# Skip everything Claude Code would otherwise load (its agent prompt,
# CLAUDE.md, hooks, plugins, MCP, the date and git status) so the prompt is
# small and identical on every run, which lets the prompt cache hit.
args=(
  -p
  --model "${BRIDGE_MODEL:-sonnet}"
  --system-prompt "$system_prompt"
  --tools ""
  --strict-mcp-config
  --setting-sources ""
  --disable-slash-commands
  --exclude-dynamic-system-prompt-sections
  --no-session-persistence
  --output-format json
)
if [[ -f "$skill_dir/schema.json" ]]; then
  args+=(--json-schema "$(cat "$skill_dir/schema.json")")
fi

# exec so the server's kill() reaches claude itself.
exec claude "${args[@]}"
