import http from "node:http";
import { HttpError } from "./httpError.mjs";
import { runClaude } from "./runClaude.mjs";

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

const isPlainObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/** Validates a `POST /run` body, throwing a 400 for anything malformed. */
function parseRunRequest(body) {
  const { input, system = "", schema, model } = body;
  if (typeof input !== "string") throw new HttpError(400, "`input` must be a string");
  if (typeof system !== "string") throw new HttpError(400, "`system` must be a string");
  if (schema !== undefined && !isPlainObject(schema)) throw new HttpError(400, "`schema` must be a JSON Schema object");
  if (model !== undefined && (typeof model !== "string" || !MODEL_PATTERN.test(model))) {
    throw new HttpError(400, "`model` must be a model alias or id");
  }
  return { input, system, schema, model };
}

/**
 * Subway: runs a prompt through headless Claude Code and returns its
 * output. Stateless and generic — the caller owns the prompt. Browser pages
 * may only call it from `allowedOrigins`.
 */
export function createSubwayServer({
  claude = "claude",
  defaultModel = "sonnet",
  allowedOrigins = [],
  timeoutMs = 180_000,
  killGraceMs = 5000,
}) {
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
      if (req.method !== "POST" || pathname !== "/run") throw new HttpError(404, "Not found");

      const request = parseRunRequest(await readJsonBody(req));
      const abort = new AbortController();
      res.on("close", () => {
        if (!res.writableFinished) abort.abort();
      });
      const output = await runClaude({
        claude,
        ...request,
        model: request.model ?? defaultModel,
        timeoutMs,
        killGraceMs,
        signal: abort.signal,
      });
      return send(res, 200, output);
    } catch (error) {
      if (res.headersSent || res.destroyed) return;
      send(res, error instanceof HttpError ? error.status : 500, { error: error.message });
    }
  });
}
