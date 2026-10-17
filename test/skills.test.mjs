import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  appendRule,
  isValidSkillName,
  normalizeRule,
  skillExists,
  withRuleAppended,
} from "../lib/skills.mjs";

test("isValidSkillName accepts kebab-case and rejects anything else", () => {
  assert.equal(isValidSkillName("proof"), true);
  assert.equal(isValidSkillName("summarize-2"), true);
  assert.equal(isValidSkillName("../etc"), false);
  assert.equal(isValidSkillName("Proof"), false);
  assert.equal(isValidSkillName(""), false);
});

test("normalizeRule collapses whitespace, trims and caps at 300 chars", () => {
  assert.equal(normalizeRule("  keep my\n  fragments \t"), "keep my fragments");
  assert.equal(normalizeRule("x".repeat(400)).length, 300);
  assert.equal(normalizeRule(" \n "), "");
});

test("withRuleAppended creates the Learned rules section when missing", () => {
  const result = withRuleAppended("# Proof\n\nFix typos.\n", "Keep fragments", "2026-10-09");
  assert.equal(result, "# Proof\n\nFix typos.\n\n## Learned rules\n\n- Keep fragments _(2026-10-09)_\n");
});

test("withRuleAppended appends after existing rules, in order", () => {
  const start = "# Proof\n\n## Learned rules\n\n- First _(2026-10-01)_\n";
  const result = withRuleAppended(start, "Second", "2026-10-09");
  assert.equal(result, "# Proof\n\n## Learned rules\n\n- First _(2026-10-01)_\n- Second _(2026-10-09)_\n");
});

test("withRuleAppended inserts into the rules section even when another section follows", () => {
  const start = "# Proof\n\n## Learned rules\n\n- First _(2026-10-01)_\n\n## Notes\n\nOther.\n";
  const result = withRuleAppended(start, "Second", "2026-10-09");
  assert.equal(
    result,
    "# Proof\n\n## Learned rules\n\n- First _(2026-10-01)_\n- Second _(2026-10-09)_\n\n## Notes\n\nOther.\n",
  );
});

test("withRuleAppended fills an empty rules section", () => {
  const result = withRuleAppended("# Proof\n\n## Learned rules\n", "Only", "2026-10-09");
  assert.equal(result, "# Proof\n\n## Learned rules\n\n- Only _(2026-10-09)_\n");
});

test("appendRule and skillExists work against a skills folder on disk", async () => {
  const skillsDir = await mkdtemp(path.join(tmpdir(), "subway-skills-"));
  await mkdir(path.join(skillsDir, "proof"));
  await writeFile(path.join(skillsDir, "proof", "SKILL.md"), "# Proof\n");

  assert.equal(await skillExists(skillsDir, "proof"), true);
  assert.equal(await skillExists(skillsDir, "missing"), false);

  await appendRule(skillsDir, "proof", "Keep fragments", "2026-10-09");
  const content = await readFile(path.join(skillsDir, "proof", "SKILL.md"), "utf8");
  assert.match(content, /## Learned rules\n\n- Keep fragments _\(2026-10-09\)_\n$/);
});
