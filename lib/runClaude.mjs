import { spawn } from "node:child_process";
import { HttpError } from "./httpError.mjs";

/** Reads the envelope `claude -p --output-format json` prints. */
export function parseClaudeEnvelope(stdout) {
  let envelope;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw new HttpError(502, "Couldn't parse Claude's output");
  }
  if (envelope.is_error) throw new HttpError(502, envelope.result || "Claude reported an error");
  if (envelope.structured_output != null) return { output: envelope.structured_output };
  return { text: envelope.result ?? "" };
}

/**
 * Arguments for headless Claude Code with `system` as the entire system
 * prompt. Everything Claude Code would otherwise load (its agent prompt,
 * CLAUDE.md, hooks, plugins, MCP, the date and git status) is skipped, so
 * the same `system` produces the same prompt every run and hits the cache.
 */
export function claudeArgs({ system, schema, model }) {
  const args = [
    "-p",
    "--model",
    model,
    "--system-prompt",
    system,
    "--tools",
    "",
    "--strict-mcp-config",
    "--setting-sources",
    "",
    "--disable-slash-commands",
    "--exclude-dynamic-system-prompt-sections",
    "--no-session-persistence",
    "--output-format",
    "json",
  ];
  if (schema) args.push("--json-schema", JSON.stringify(schema));
  return args;
}

/**
 * Runs `claude` with `input` on stdin. Kills the child on timeout (504) or
 * when `signal` aborts (the HTTP client went away), escalating to SIGKILL
 * if it hasn't exited `killGraceMs` after SIGTERM.
 */
export function runClaude({ claude, system, input, schema, model, timeoutMs, killGraceMs = 5000, signal }) {
  return new Promise((resolve, reject) => {
    const child = spawn(claude, claudeArgs({ system, schema, model }), { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let exited = false;

    const terminate = () => {
      child.kill("SIGTERM");
      const escalate = setTimeout(() => {
        if (!exited) child.kill("SIGKILL");
      }, killGraceMs);
      child.once("close", () => clearTimeout(escalate));
    };

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      fn(value);
    };
    const timer = setTimeout(() => {
      terminate();
      settle(reject, new HttpError(504, "Skill run timed out"));
    }, timeoutMs);
    const onAbort = () => {
      terminate();
      settle(reject, new HttpError(499, "Client went away"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();

    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => settle(reject, new HttpError(502, `Couldn't start claude: ${error.message}`)));
    child.on("close", (code) => {
      exited = true;
      if (code !== 0) return settle(reject, new HttpError(502, stderr.trim() || `claude exited with code ${code}`));
      try {
        settle(resolve, parseClaudeEnvelope(stdout));
      } catch (error) {
        settle(reject, error);
      }
    });
    // claude may exit before reading stdin (e.g. a bad flag) — don't let the
    // resulting EPIPE crash the server.
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
