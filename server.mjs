import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBridgeServer } from "./lib/server.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.BRIDGE_PORT ?? 4317);

const server = createBridgeServer({
  skillsDir: path.join(here, ".claude", "skills"),
  runner: process.env.BRIDGE_RUNNER ?? path.join(here, "bin", "run-skill.sh"),
  cwd: here,
});

server.listen(port, "127.0.0.1", () => {
  console.log(`claude bridge listening on http://127.0.0.1:${port}`);
});
