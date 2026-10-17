import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import http from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { claudeArgs } from "../lib/runClaude.mjs";
import { createSubwayServer } from "../lib/server.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = path.join(here, "fixtures", "fake-claude.mjs");
const servers = [];

async function startServer(options = {}) {
  const server = createSubwayServer({ claude: FAKE_CLAUDE, timeoutMs: 5000, ...options });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return { base: `http://127.0.0.1:${server.address().port}` };
}

after(() => {
  for (const server of servers) {
    server.closeAllConnections();
    server.close();
  }
});

const post = (url, body, init = {}) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), ...init });

const flag = (args, name) => args[args.indexOf(name) + 1];

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(predicate, timeoutMs = 3000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test("GET /health responds ok", async () => {
  const { base } = await startServer();
  const response = await fetch(`${base}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("run pipes input to claude with the caller's system prompt, schema and model", async () => {
  const { base } = await startServer();
  const schema = { type: "object", properties: { n: { type: "number" } } };
  const response = await post(`${base}/run`, { system: "Be terse.", input: "ok Teh cat", schema, model: "haiku" });
  assert.equal(response.status, 200);
  const { output } = await response.json();
  assert.equal(output.input, "ok Teh cat");
  assert.equal(flag(output.args, "--system-prompt"), "Be terse.");
  assert.deepEqual(JSON.parse(flag(output.args, "--json-schema")), schema);
  assert.equal(flag(output.args, "--model"), "haiku");
});

test("run defaults to the server's model, an empty system prompt and no schema", async () => {
  const { base } = await startServer({ defaultModel: "sonnet" });
  const { output } = await (await post(`${base}/run`, { input: "ok" })).json();
  assert.equal(flag(output.args, "--model"), "sonnet");
  assert.equal(flag(output.args, "--system-prompt"), "");
  assert.ok(!output.args.includes("--json-schema"));
});

test("run returns { text } when there is no structured output", async () => {
  const { base } = await startServer();
  const response = await post(`${base}/run`, { input: "text hi" });
  assert.deepEqual(await response.json(), { text: "plain: text hi" });
});

test("run rejects malformed requests with 400", async () => {
  const { base } = await startServer();
  for (const body of [
    {},
    { input: 42 },
    { input: "ok", system: 1 },
    { input: "ok", schema: "{}" },
    { input: "ok", schema: [] },
    { input: "ok", model: "" },
    { input: "ok", model: 42 },
    { input: "ok", model: "--tools Bash" },
    { input: "ok", model: "Sonnet" },
  ]) {
    assert.equal((await post(`${base}/run`, body)).status, 400, JSON.stringify(body));
  }
  const withId = await post(`${base}/run`, { input: "ok", model: "claude-opus-5-5[1m]" });
  assert.equal(flag((await withId.json()).output.args, "--model"), "claude-opus-5-5[1m]");
});

test("run maps claude failures to 502 with a message", async () => {
  const { base } = await startServer();
  for (const [mode, message] of [
    ["crash", /boom/],
    ["claude-error", /rate limited/],
    ["garbage", /parse/i],
  ]) {
    const response = await post(`${base}/run`, { input: mode });
    assert.equal(response.status, 502, mode);
    assert.match((await response.json()).error, message);
  }
});

test("run returns 502 when claude can't be started", async () => {
  const { base } = await startServer({ claude: "/nonexistent/claude" });
  const response = await post(`${base}/run`, { input: "ok" });
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /Couldn't start claude/);
});

test("run kills claude and returns 504 on timeout", async () => {
  const { base } = await startServer({ timeoutMs: 200 });
  const response = await post(`${base}/run`, { input: "slow" });
  assert.equal(response.status, 504);
});

test("run kills claude when the client disconnects", async () => {
  const { base } = await startServer();
  const pidFile = path.join(await mkdtemp(path.join(tmpdir(), "subway-")), "slow.pid");
  process.env.FAKE_PID_FILE = pidFile;
  const controller = new AbortController();
  const pending = post(`${base}/run`, { input: "slow" }, { signal: controller.signal }).catch(() => {});
  await waitFor(() => existsSync(pidFile));
  const pid = Number(await readFile(pidFile, "utf8"));
  controller.abort();
  await pending;
  await waitFor(() => !isAlive(pid));
  delete process.env.FAKE_PID_FILE;
});

test("escalates to SIGKILL when claude ignores SIGTERM", async () => {
  const { base } = await startServer({ timeoutMs: 200, killGraceMs: 200 });
  const pidFile = path.join(await mkdtemp(path.join(tmpdir(), "subway-")), "stubborn.pid");
  process.env.FAKE_PID_FILE = pidFile;
  const response = await post(`${base}/run`, { input: "stubborn" });
  assert.equal(response.status, 504);
  const pid = Number(await readFile(pidFile, "utf8"));
  await waitFor(() => !isAlive(pid));
  delete process.env.FAKE_PID_FILE;
});

test("rejects unknown routes and oversized bodies", async () => {
  const { base } = await startServer();
  assert.equal((await fetch(`${base}/nope`)).status, 404);
  assert.equal((await fetch(`${base}/run`)).status, 404);
  assert.equal((await post(`${base}/skills/proof/run`, { input: "ok" })).status, 404);
  assert.equal((await post(`${base}/run`, { input: "x".repeat(1024 * 1024 + 10) })).status, 413);
});

test("CORS echoes allowed origins only and answers preflight", async () => {
  const { base } = await startServer({ allowedOrigins: ["app://local", "http://localhost:1420"] });
  const allowed = await fetch(`${base}/health`, { headers: { Origin: "app://local" } });
  assert.equal(allowed.headers.get("access-control-allow-origin"), "app://local");
  const denied = await fetch(`${base}/health`, { headers: { Origin: "https://evil.example" } });
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
  const preflight = await fetch(`${base}/run`, {
    method: "OPTIONS",
    headers: { Origin: "http://localhost:1420", "Access-Control-Request-Method": "POST" },
  });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get("access-control-allow-headers"), /Content-Type/);
});

test("rejects requests from foreign origins, so web pages can't spend your subscription", async () => {
  const { base } = await startServer();
  const pidFile = path.join(await mkdtemp(path.join(tmpdir(), "subway-")), "slow.pid");
  process.env.FAKE_PID_FILE = pidFile;
  const response = await fetch(`${base}/run`, {
    method: "POST",
    headers: { Origin: "https://evil.example", "Content-Type": "text/plain" },
    body: JSON.stringify({ input: "slow" }),
  });
  assert.equal(response.status, 403);
  assert.equal(existsSync(pidFile), false);
  delete process.env.FAKE_PID_FILE;
});

test("requires a JSON content type on POST, forcing a CORS preflight from browsers", async () => {
  const { base } = await startServer();
  const response = await fetch(`${base}/run`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ input: "ok" }),
  });
  assert.equal(response.status, 415);
});

test("rejects a foreign Host header (DNS rebinding)", async () => {
  const { base } = await startServer();
  const { port } = new URL(base);
  const status = await new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: "/health", headers: { Host: `evil.example:${port}` } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(status, 403);
  assert.equal((await fetch(`${base}/health`)).status, 200);
});

test("claudeArgs skips Claude Code's own context so the prompt stays small and cacheable", () => {
  const args = claudeArgs({ system: "S", model: "sonnet" });
  for (const name of ["-p", "--strict-mcp-config", "--disable-slash-commands", "--exclude-dynamic-system-prompt-sections", "--no-session-persistence"]) {
    assert.ok(args.includes(name), `missing ${name}`);
  }
  assert.equal(flag(args, "--setting-sources"), "");
  assert.equal(flag(args, "--tools"), "");
  assert.equal(flag(args, "--output-format"), "json");
});
