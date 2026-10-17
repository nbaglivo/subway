# subway

Turn prompt files into local HTTP endpoints, powered by the AI subscription you already pay for.

subway is a tiny, dependency-free Node server. Each **skill** is a folder with a prompt (`SKILL.md`) and an optional JSON schema. `POST` some input to it and you get typed JSON back. Under the hood it runs headless Claude Code (`claude -p`), so calls go through your Claude subscription. You don't need an API key and you aren't billed per token.

It isn't an API gateway. A gateway forwards your raw API requests to a provider. With subway, callers never send prompts: they call a named function, like `proof(text) → suggestions[]`. Why it exists and how it got here: [story.md](story.md).

```sh
npm start        # http://127.0.0.1:4317
npm test
```

Requires Node (see `mise.toml`) and a logged-in [Claude Code](https://claude.com/claude-code) on `PATH`.

### Start at login (macOS)

```sh
npm run agent:install     # LaunchAgent com.nbaglivo.subway; restarts it if it dies
npm run agent:uninstall
```

Logs go to `~/Library/Logs/subway.log`. The agent records the absolute paths of `node`, `claude` and this folder at install time, so re-run `agent:install` if you move the repo or switch Node major versions.

## API

- `GET /health` → `{ "ok": true }`
- `POST /skills/<name>/run` with `{ "input": "...", "model": "haiku" }` → the skill's structured output (or `{ "text": "..." }`). `model` is optional (an alias like `sonnet`/`haiku`/`opus` or a full model id); it defaults to Sonnet.
- `POST /skills/<name>/rules` with `{ "rule": "..." }` → appends a dated bullet under `## Learned rules` in that skill's `SKILL.md`

```sh
curl -s localhost:4317/skills/proof/run -H 'Content-Type: application/json' -d '{"input":"Teh cat sat."}'
```

## Configuration

| Variable | Default | |
|---|---|---|
| `SUBWAY_PORT` | `4317` | Port on `127.0.0.1` |
| `SUBWAY_MODEL` | `sonnet` | Model when a request doesn't pass one |
| `SUBWAY_ORIGINS` | Medialuna's Tauri origins | Comma-separated browser origins allowed to call it |

subway only listens on `127.0.0.1`. It rejects foreign `Host` headers (DNS rebinding) and any browser `Origin` not in `SUBWAY_ORIGINS`. Requests without an `Origin`, such as curl or local scripts, are allowed.

## Skills

Each skill is a folder in `.claude/skills/<name>/` with a `SKILL.md` (instructions) and an optional `schema.json` (forces structured output). Add a folder to add a skill, with no code changes. Edit `SKILL.md` freely, and prune `## Learned rules` whenever it gets noisy.

The body of `SKILL.md` (minus frontmatter) is the entire system prompt. The runner skips Claude Code's agent prompt, CLAUDE.md, hooks, plugins and MCP, so calls stay small (~1.7k tokens for `proof`) and hit the prompt cache.

Run one by hand: `echo "Teh cat sat." | bin/run-skill.sh proof`

Its first client is the **Proof** button in Medialuna, my notes app, which calls the `proof` skill.

Use it for your own tools on your own machine. A personal subscription isn't meant to back a service that other people use.
