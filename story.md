# subway: using my Claude subscription as an API

*subway started life inside Medialuna as "the bridge", which is what the story calls it until it moves out.*

## Why

I pay for a Claude subscription. Medialuna, my notes app, needed an LLM for exactly one thing at first: a **Proof** button that fixes typos and grammar in a note without touching my voice.

The obvious way is the Anthropic API: get a key, add billing, pay per token. That's a second bill for a model I already pay for every month, and it means managing a key inside a desktop app just to proofread my own notes.

But Claude Code already runs on my subscription, and it has a headless mode: `claude -p`. Give it a prompt, get an answer, no terminal UI. If a script can call it, a local HTTP server can call the script, and then anything on my machine can call the server. So one subscription covers my coding *and* my apps' LLM calls, with no API key and no per-token bill.

That's the bridge.

## How I built it (2026-10-09)

I wanted it small and not tied to Medialuna:

```
Medialuna ──fetch──▶ bridge (Node, 127.0.0.1:4317) ──spawn──▶ run-skill.sh ──▶ claude -p
```

- **A dependency-free Node server** with two real endpoints: `POST /skills/<name>/run` runs a skill on some input, and `POST /skills/<name>/rules` teaches a skill a new rule.
- **Skills are folders.** `.claude/skills/<name>/SKILL.md` holds the instructions and an optional `schema.json` forces structured output through `--json-schema`. Adding a skill means adding a folder, with no code changes.
- **Instructions that learn.** When I reject a suggestion I can type a rule ("I don't like to open with a question mark"), and the bridge appends it to `## Learned rules` in `SKILL.md`. The prompt is a file I own and can edit by hand.
- **A bash runner** (`bin/run-skill.sh`) that sends the input on stdin to `claude -p`. I can also run it straight from a terminal: `echo "Teh cat" | bin/run-skill.sh proof`.

Hardening came the same day. A server on localhost can be reached from any web page in my browser, so the bridge rejects foreign `Host` headers (DNS rebinding) and foreign `Origin`s, not just CORS responses. Runs that hang get SIGTERM, then SIGKILL. When the app cancels, the bridge kills the `claude` process too. A LaunchAgent starts the bridge at login so the Proof button just works.

On 2026-10-11 Proof also became a command-palette action (`page:proof`).

## The questions (2026-10-17)

Once it worked I started wondering what I'd given up compared with a "real" setup such as calling the Anthropic API directly or going through Vercel's AI Gateway:

- Does going through the bridge send more context than it needs to?
- Does the model "forget" things?
- Is there no prompt caching somehow?
- What's fundamentally different between a headless Claude Code call and calling the API?

### What I found

I ran the same 6-word note through the bridge twice and looked at the `usage` block Claude Code returns:

| | Prompt tokens | Read from cache | Cost at API prices |
|---|---|---|---|
| 1st call | 12,986 | 0 | $0.108 |
| 2nd call | 15,929 | **0** | $0.130 |

That's about 13–16k tokens to proofread six words, and **the cache never hit**. (On a subscription I don't pay those dollars, but that's roughly how much of my usage limit each call ate.)

The reason: `claude -p "/proof"` starts the **whole Claude Code agent**. Every call carried:

- Claude Code's own system prompt, written for a coding agent and not for proofreading
- my global `~/.claude/CLAUDE.md` (git conventions and the like)
- every SessionStart hook, including a big plugin block about using skills
- the list of installed skills and plugins, and MCP server instructions
- parts that change on every run: the date, git status, environment details

That last group, plus plugins and MCP loading in a slightly different shape each time, made the prompt differ from one call to the next. That's why the size jumped from 12,986 to 15,929 tokens, and why the cache never matched. And without `--model`, every proofread ran on Opus, my default for coding.

**Forgetting** turned out to be a non-issue. Every call is a fresh process with `--no-session-persistence`, which is just what the Messages API is: stateless, and you send everything each time. The skill's memory is `SKILL.md`, and it's sent in full every call either way. The only real cost to quality was ~12k tokens of unrelated instructions around a short proofreading prompt.

**Bridge vs. API / gateway**, in short:

| | The bridge | Messages API / Vercel AI Gateway |
|---|---|---|
| Auth and billing | My subscription, through the CLI | API key, pay per token |
| What gets sent | Whatever Claude Code adds + my skill | Exactly what I send |
| Control | Model, effort, JSON schema | max_tokens, temperature, cache breakpoints, streaming… |
| Overhead | Starts a process per request | One HTTPS request |
| Extras | Learned rules, skills as folders | Gateway: provider fallbacks, logs, budgets, rate limits |

A gateway is a thin proxy in front of the API. My bridge runs a whole agent. That's the trade I made for using my subscription, and it's fine for a personal, local tool, as long as I control what the agent loads.

## The fix

Claude Code has flags to turn off nearly everything it loads. The runner now:

- passes the body of `SKILL.md` as the **entire** system prompt (`--system-prompt`)
- skips settings, CLAUDE.md, hooks and plugins (`--setting-sources ""`), MCP (`--strict-mcp-config`), skills (`--disable-slash-commands`) and the parts that change per run (`--exclude-dynamic-system-prompt-sections`)
- runs on **Sonnet** by default; a request can pass `"model"` to pick another one (`SUBWAY_MODEL` changes the default)

Same note, same suggestions:

| | Prompt tokens | Read from cache | Time | Cost at API prices |
|---|---|---|---|---|
| Before, Opus | ~14,000 | 0 | ~3.5s | ~$0.12 |
| After, Sonnet, 1st call | 1,710 | 0 | 2.5s | $0.0082 |
| After, Sonnet, 2nd call | 0 new | 1,710 | 2.4s | **$0.0015** |

That's roughly **80× less** usage per proofread, and the prompt is now exactly my `SKILL.md` and nothing else. The bridge keeps everything I liked about it: no API key, skills as folders, rules I can teach. Under the hood it now behaves much more like a plain API call.

## Its own repo, and a name

By then the bridge had nothing to do with Medialuna except being its first client. Medialuna only talks to it over HTTP. So it moved into its own repo, with its git history kept.

Moving it out meant deciding what it actually *is*. It's not an API gateway. A gateway forwards your API requests, prompts and all, and adds routing and metering. Here the caller never writes a prompt: it calls a named skill, and the skill owns the prompt, the schema and the learned rules. It's closer to **prompts served as functions over HTTP**, running on a flat-rate subscription instead of a per-token bill.

I named it **subway**: **sub**scription + gate**way**. It's a little ironic, since it isn't really a gateway. A subway also runs on a flat fare, which fits.

What changed in the move: `BRIDGE_*` variables became `SUBWAY_*`, the LaunchAgent became `com.nbaglivo.subway`, and the browser origins allowed to call it (once hardcoded to Medialuna's) are now configurable through `SUBWAY_ORIGINS`.

## A clean cut

Writing the README for the new repo, one thing looked wrong. subway still knew about skills: it kept the `proof` prompt, its schema and my learned rules in its own folders, and had an endpoint just for appending rules. None of that is subway's business. My rule "don't open with a question mark" is about my writing, and it belongs with my notes.

So I made the cut. subway became a plain local LLM API with one endpoint:

```
POST /run  { "system": "...", "input": "...", "schema": { ... }, "model": "haiku" }
→ { "output": { ... } }  or  { "text": "..." }
```

It's stateless and has no files on disk. It doesn't even need the bash runner anymore, because it spawns `claude` directly. Medialuna now owns everything about Proof:

- **The prompt is a note.** `Proof prompt.md` sits at the root of my vault. I edit it in Medialuna like any other note, and Proof sends it as `system` every time.
- **Learned rules are edits to that note.** Rejecting a suggestion and typing a rule appends a dated bullet to its `## Learned rules` section. No HTTP call is involved.
- **The schema lives in code**, next to the code that parses the suggestions, because the two have to agree.

I briefly considered copying Anthropic's `/v1/messages` instead, so the official SDK would work by changing its base URL. I decided against it: `claude -p` takes one prompt, not a conversation with tool calls, `temperature` and `max_tokens`. A copy that looks compatible but quietly ignores half the fields is worse than a small API that's honest about what it does.

The trade-off: before, a caller could only run the skills I'd defined. Now anything allowed to call subway can run any prompt on my subscription. With tools disabled, and only `127.0.0.1` and a short list of browser origins allowed in, the worst case is someone using up my usage limit, which I can live with.

Caching still works, because Proof sends the same note as `system` every time. The prompt only changes when I edit the note or teach it a rule.

## Still on the table

- **Streaming.** `--output-format stream-json` would let the Proof panel show suggestions as they arrive.
- **Process startup.** Each request still starts a fresh `claude` process. A long-lived worker could remove that, at the cost of more moving parts.
- **Usage in the response.** subway drops the token counts `claude -p` reports. Returning them would make it easy to check that caching keeps working.
