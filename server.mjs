import { createSubwayServer } from "./lib/server.mjs";

const port = Number(process.env.SUBWAY_PORT ?? 4317);
// Medialuna's Tauri webview (prod and dev) by default.
const allowedOrigins = (process.env.SUBWAY_ORIGINS ?? "tauri://localhost,http://tauri.localhost,http://localhost:1420")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const server = createSubwayServer({
  claude: process.env.SUBWAY_CLAUDE ?? "claude",
  defaultModel: process.env.SUBWAY_MODEL ?? "sonnet",
  allowedOrigins,
});

server.listen(port, "127.0.0.1", () => {
  console.log(`subway listening on http://127.0.0.1:${port}`);
});
