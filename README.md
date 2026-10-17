# Claude bridge

A tiny local HTTP service that runs Claude Code skills headlessly (`claude -p`), so anything on this machine can use your Claude subscription. Medialuna's **Proof** button is its first client.

```sh
npm run bridge            # http://127.0.0.1:4317 (BRIDGE_PORT to change)
npm run test:bridge
```

### Start at login

```sh
npm run bridge:install    # LaunchAgent com.medialuna.bridge; restarts it if it dies
npm run bridge:uninstall
```

Logs go to `~/Library/Logs/medialuna-bridge.log`. The agent records the absolute paths of `node`, `claude` and this folder at install time, so re-run `bridge:install` if you move the repo or switch Node major versions.

## API

- `GET /health` → `{ "ok": true }`
- `POST /skills/<name>/run` with `{ "input": "...", "model": "haiku" }` → the skill's structured output (or `{ "text": "..." }`). `model` is optional (an alias like `sonnet`/`haiku`/`opus` or a full model id); it defaults to Sonnet.
- `POST /skills/<name>/rules` with `{ "rule": "..." }` → appends a dated bullet under `## Learned rules` in that skill's `SKILL.md`

## Skills

Each skill is a folder in `.claude/skills/<name>/` with a `SKILL.md` (instructions) and an optional `schema.json` (forces structured output). Add a folder to add a skill — no code changes. Edit `SKILL.md` freely; prune `## Learned rules` whenever it gets noisy.

The body of `SKILL.md` (minus frontmatter) is the entire system prompt: the runner skips Claude Code's agent prompt, CLAUDE.md, hooks, plugins and MCP, so calls stay around 1.7k tokens and hit the prompt cache. Skills run on Sonnet unless the request passes `model`; set `BRIDGE_MODEL` to change the default.

Run one by hand: `echo "Teh cat sat." | bin/run-skill.sh proof`

Why it exists and how it got here: [story.md](story.md).
