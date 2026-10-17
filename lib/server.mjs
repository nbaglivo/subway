import http from "node:http";
import { HttpError } from "./httpError.mjs";
import { runSkill } from "./runSkill.mjs";
import { appendRule, isValidSkillName, normalizeRule, skillExists } from "./skills.mjs";

const MAX_BODY_BYTES = 1024 * 1024;
const MODEL_PATTERN = /^[a-z0-9][a-z0-9.\-]*(\[1m\])?$/;

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

/** Only `127.0.0.1:<port>` / `localhost:<port>` — anything else is a
 *  DNS-rebinding attempt to reach subway through a foreign hostname. */
function isAllowedHost(req) {
  const port = req.socket.localPort;
  return req.headers.host === `127.0.0.1:${port}` || req.headers.host === `localhost:${port}`;
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

function applyCors(req, res, allowedOrigins) {
  const origin = req.headers.origin;
  if (!origin || !allowedOrigins.has(origin)) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

/**
 * Subway: runs a named skill through `runner` and appends learned
 * rules to a skill's SKILL.md. Generic — knows nothing about its clients.
 * Browser pages may only call it from `allowedOrigins`.
 */
export function createSubwayServer({ skillsDir, runner, cwd, allowedOrigins = [], timeoutMs = 180_000, killGraceMs = 5000 }) {
  const origins = new Set(allowedOrigins);
  return http.createServer(async (req, res) => {
    applyCors(req, res, origins);
    try {
      // CORS alone only hides responses; these checks stop web pages from
      // making the request at all. Requests without an Origin (curl, local
      // scripts) are allowed.
      if (!isAllowedHost(req)) throw new HttpError(403, "Forbidden host");
      const origin = req.headers.origin;
      if (origin && !origins.has(origin)) throw new HttpError(403, "Forbidden origin");
      if (req.method === "OPTIONS") return send(res, 204);
      if (req.method === "POST" && !(req.headers["content-type"] ?? "").startsWith("application/json")) {
        throw new HttpError(415, "Content-Type must be application/json");
      }

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
        if (body.model !== undefined && (typeof body.model !== "string" || !MODEL_PATTERN.test(body.model))) {
          throw new HttpError(400, "`model` must be a model alias or id");
        }
        const abort = new AbortController();
        res.on("close", () => {
          if (!res.writableFinished) abort.abort();
        });
        const output = await runSkill({
          runner,
          cwd,
          name,
          input: body.input,
          model: body.model,
          timeoutMs,
          killGraceMs,
          signal: abort.signal,
        });
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
