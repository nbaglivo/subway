import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SKILL_NAME = /^[a-z0-9-]+$/;
const RULES_HEADING = "## Learned rules";
export const MAX_RULE_LENGTH = 300;

export function isValidSkillName(name) {
  return SKILL_NAME.test(name);
}

function skillFile(skillsDir, name) {
  return path.join(skillsDir, name, "SKILL.md");
}

export async function skillExists(skillsDir, name) {
  try {
    await access(skillFile(skillsDir, name));
    return true;
  } catch {
    return false;
  }
}

export function normalizeRule(rule) {
  return rule.replace(/\s+/g, " ").trim().slice(0, MAX_RULE_LENGTH).trim();
}

/**
 * Adds `rule` as a dated bullet at the end of the `## Learned rules`
 * section, creating the section at the end of the file if it's missing.
 * The section ends at the next `#`/`##` heading or end of file, so other
 * sections the user adds after it are left alone.
 */
export function withRuleAppended(markdown, rule, date) {
  const bullet = `- ${rule} _(${date})_`;
  const lines = markdown.replace(/\s+$/, "").split("\n");
  const headingIndex = lines.findIndex((line) => line.trim() === RULES_HEADING);

  if (headingIndex === -1) return `${lines.join("\n")}\n\n${RULES_HEADING}\n\n${bullet}\n`;

  let sectionEnd = lines.length;
  for (let i = headingIndex + 1; i < lines.length; i++) {
    if (/^#{1,2} /.test(lines[i])) {
      sectionEnd = i;
      break;
    }
  }
  let insertAt = sectionEnd;
  while (insertAt > headingIndex + 1 && lines[insertAt - 1].trim() === "") insertAt--;

  const inserted = [];
  if (insertAt === headingIndex + 1) inserted.push("");
  inserted.push(bullet);
  if (insertAt < lines.length && lines[insertAt].trim() !== "") inserted.push("");
  lines.splice(insertAt, 0, ...inserted);
  return `${lines.join("\n")}\n`;
}

function localDate() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export async function appendRule(skillsDir, name, rule, date = localDate()) {
  const file = skillFile(skillsDir, name);
  const markdown = await readFile(file, "utf8");
  await writeFile(file, withRuleAppended(markdown, rule, date));
}
