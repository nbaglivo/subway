import http from "node:http";
import { HttpError } from "./httpError.mjs";
import { runSkill } from "./runSkill.mjs";
import { appendRule, isValidSkillName, normalizeRule, skillExists } from "./skills.mjs";

const ALLOWED_ORIGINS = new Set(["tauri://localhost", "http://tauri.localhost", "http://localhost:1420"]);
const MAX_BODY_BYTES = 1024 * 1024;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    req.on("end", () => {
      if (size > MAX_BODY_BYTES) return reject(new HttpError(413, "Request body too large"));
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new HttpError(400, "Body must be JSON"));
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, body) {
  if (body === undefined) {
    res.writeHead(status);
    res.end();
    return;
  }
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

/**
 * The bridge: runs a named skill through `runner` and appends learned
 * rules to a skill's SKILL.md. Generic — knows nothing about Medialuna.
 */
export function createBridgeServer({ skillsDir, runner, cwd, timeoutMs = 180_000 }) {
  return http.createServer(async (req, res) => {
    applyCors(req, res);
    try {
      if (req.method === "OPTIONS") return send(res, 204);

      const { pathname } = new URL(req.url, "http://127.0.0.1");
      if (req.method === "GET" && pathname === "/health") return send(res, 200, { ok: true });

      const match = /^\/skills\/([^/]+)\/(run|rules)$/.exec(pathname);
      if (!match || req.method !== "POST") throw new HttpError(404, "Not found");
      const [, name, action] = match;
      if (!isValidSkillName(name)) throw new HttpError(400, "Invalid skill name");
      if (!(await skillExists(skillsDir, name))) throw new HttpError(404, `Unknown skill: ${name}`);

      const body = await readJsonBody(req);

      if (action === "run") {
        if (typeof body.input !== "string") throw new HttpError(400, "`input` must be a string");
        const abort = new AbortController();
        res.on("close", () => {
          if (!res.writableFinished) abort.abort();
        });
        const output = await runSkill({ runner, cwd, name, input: body.input, timeoutMs, signal: abort.signal });
        return send(res, 200, output);
      }

      const rule = typeof body.rule === "string" ? normalizeRule(body.rule) : "";
      if (!rule) throw new HttpError(400, "`rule` must be a non-empty string");
      await appendRule(skillsDir, name, rule);
      return send(res, 204);
    } catch (error) {
      if (res.headersSent || res.destroyed) return;
      send(res, error instanceof HttpError ? error.status : 500, { error: error.message });
    }
  });
}
