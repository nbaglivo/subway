import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSubwayServer } from "./lib/server.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.SUBWAY_PORT ?? 4317);
// Medialuna's Tauri webview (prod and dev) by default.
const allowedOrigins = (process.env.SUBWAY_ORIGINS ?? "tauri://localhost,http://tauri.localhost,http://localhost:1420")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const server = createSubwayServer({
  skillsDir: path.join(here, ".claude", "skills"),
  runner: process.env.SUBWAY_RUNNER ?? path.join(here, "bin", "run-skill.sh"),
  cwd: here,
  allowedOrigins,
});

server.listen(port, "127.0.0.1", () => {
  console.log(`subway listening on http://127.0.0.1:${port}`);
});
