#!/usr/bin/env node
// Stands in for run-skill.sh in tests. The skill name argument picks the
// behaviour; stdout mimics `claude -p --output-format json`.
import { writeFileSync } from "node:fs";

const mode = process.argv[2];
const print = (envelope) => process.stdout.write(JSON.stringify(envelope));
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  if (mode === "ok") print({ is_error: false, result: "", structured_output: { echo: input, cwd: process.cwd() } });
  else if (mode === "text") print({ is_error: false, result: `plain: ${input}` });
  else if (mode === "claude-error") print({ is_error: true, result: "rate limited" });
  else if (mode === "garbage") process.stdout.write("not json");
  else if (mode === "crash") {
    process.stderr.write("boom\n");
    process.exit(3);
  } else if (mode === "slow") {
    if (process.env.FAKE_PID_FILE) writeFileSync(process.env.FAKE_PID_FILE, String(process.pid));
    setTimeout(() => print({ is_error: false, result: "late" }), 10_000);
  }
});
