# Claude bridge

A tiny local HTTP service that runs Claude Code skills headlessly (`claude -p`), so anything on this machine can use your Claude subscription. Medialuna's **Proof** button is its first client.

```sh
npm run bridge            # http://127.0.0.1:4317 (BRIDGE_PORT to change)
npm run test:bridge
```

## API

- `GET /health` → `{ "ok": true }`
- `POST /skills/<name>/run` with `{ "input": "..." }` → the skill's structured output (or `{ "text": "..." }`)
- `POST /skills/<name>/rules` with `{ "rule": "..." }` → appends a dated bullet under `## Learned rules` in that skill's `SKILL.md`

## Skills

Each skill is a folder in `.claude/skills/<name>/` with a `SKILL.md` (instructions) and an optional `schema.json` (forces structured output). Add a folder to add a skill — no code changes. Edit `SKILL.md` freely; prune `## Learned rules` whenever it gets noisy.

Run one by hand: `echo "Teh cat sat." | bin/run-skill.sh proof`
