# subway

A local LLM API that runs on the AI subscription you already pay for.

subway is a tiny, dependency-free Node server with one endpoint: send a system prompt and some input (and optionally a JSON schema and a model), and get the model's output back. Under the hood it runs headless Claude Code (`claude -p`), so calls go through your Claude subscription. You don't need an API key and you aren't billed per token.

It's stateless and knows nothing about its callers: each app owns its own prompts. Why it exists and how it got here: [story.md](story.md).

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

`GET /health` → `{ "ok": true }`

`POST /run`

| Field | | |
|---|---|---|
| `input` | required | The user message, piped to `claude` on stdin |
| `system` | optional | The entire system prompt (default: empty) |
| `schema` | optional | A JSON Schema object; forces structured output |
| `model` | optional | An alias (`sonnet`, `haiku`, `opus`) or a full model id; defaults to `SUBWAY_MODEL` |

It responds `200 { "output": … }` when a schema was given, and `200 { "text": "…" }` otherwise. Errors come back as `{ "error": "…" }`: `400` for a malformed request, `502` when Claude fails, `504` after 3 minutes.

```sh
curl -s localhost:4317/run -H 'Content-Type: application/json' -d '{
  "system": "Fix typos only. Reply with the corrected text.",
  "input": "Teh cat sat.",
  "model": "haiku"
}'
```

`system` is all Claude sees besides `input`: subway skips Claude Code's agent prompt, CLAUDE.md, hooks, plugins and MCP. So a call costs about as much as its own prompt, and sending the same `system` every time hits the prompt cache. Conversations, tools and sampling settings (`temperature`, `max_tokens`) aren't supported, since `claude -p` doesn't take them.

## Configuration

| Variable | Default | |
|---|---|---|
| `SUBWAY_PORT` | `4317` | Port on `127.0.0.1` |
| `SUBWAY_MODEL` | `sonnet` | Model when a request doesn't pass one |
| `SUBWAY_ORIGINS` | Medialuna's Tauri origins | Comma-separated browser origins allowed to call it |
| `SUBWAY_CLAUDE` | `claude` | The Claude Code binary |

subway only listens on `127.0.0.1`. It rejects foreign `Host` headers (DNS rebinding) and any browser `Origin` not in `SUBWAY_ORIGINS`. Requests without an `Origin`, such as curl or local scripts, are allowed. Anything that can call it can run any prompt on your subscription, so keep `SUBWAY_ORIGINS` short.

## Clients

Its first client is the **Proof** button in Medialuna, my notes app. Proof keeps its prompt and learned rules in a note in the vault and sends it as `system`.

Use it for your own tools on your own machine. A personal subscription isn't meant to back a service that other people use.
