import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const RUN_SKILL = path.join(here, "..", "bin", "run-skill.sh");
const SKILL_DIR = path.join(here, "..", ".claude", "skills", "proof");

/** Runs run-skill.sh against a fake `claude` that records its argv and stdin. */
async function runWithFakeClaude(skill, input, env = {}) {
  const binDir = await mkdtemp(path.join(tmpdir(), "bridge-claude-"));
  const fake = path.join(binDir, "claude");
  await writeFile(
    fake,
    `#!/usr/bin/env node
let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => process.stdout.write(JSON.stringify({ args: process.argv.slice(2), input })));
`,
  );
  await chmod(fake, 0o755);
  const stdout = execFileSync(RUN_SKILL, [skill], {
    input,
    env: { ...process.env, ...env, PATH: `${binDir}:${process.env.PATH}` },
  });
  return JSON.parse(stdout);
}

const flag = (args, name) => args[args.indexOf(name) + 1];

test("passes SKILL.md without frontmatter as the system prompt and the input on stdin", async () => {
  const { args, input } = await runWithFakeClaude("proof", "Teh cat");
  const skill = await readFile(path.join(SKILL_DIR, "SKILL.md"), "utf8");
  const systemPrompt = flag(args, "--system-prompt");
  assert.equal(input, "Teh cat");
  assert.ok(!systemPrompt.includes("name: proof"));
  assert.ok(systemPrompt.trimStart().startsWith("You are proofreading"));
  assert.ok(skill.trimEnd().endsWith(systemPrompt.trimEnd()));
});

test("skips Claude Code's own context so the prompt stays small and cacheable", async () => {
  const { args } = await runWithFakeClaude("proof", "x");
  for (const name of ["--strict-mcp-config", "--disable-slash-commands", "--exclude-dynamic-system-prompt-sections"]) {
    assert.ok(args.includes(name), `missing ${name}`);
  }
  assert.equal(flag(args, "--setting-sources"), "");
  assert.equal(flag(args, "--tools"), "");
});

test("defaults to sonnet and honours BRIDGE_MODEL", async () => {
  assert.equal(flag((await runWithFakeClaude("proof", "x")).args, "--model"), "sonnet");
  assert.equal(flag((await runWithFakeClaude("proof", "x", { BRIDGE_MODEL: "haiku" })).args, "--model"), "haiku");
});

test("forces structured output when the skill has a schema.json", async () => {
  const { args } = await runWithFakeClaude("proof", "x");
  const schema = JSON.parse(await readFile(path.join(SKILL_DIR, "schema.json"), "utf8"));
  assert.deepEqual(JSON.parse(flag(args, "--json-schema")), schema);
});
