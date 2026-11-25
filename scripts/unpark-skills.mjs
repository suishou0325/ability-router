// Un-park: remove disable-model-invocation: true from skills' frontmatter.
// Idempotent, scans the whole skills dir (matches by content, not directory name).
//
// Usage: node unpark-skills.mjs [--dir <skills-dir>] [--list <curated.json>] [--except a,b,c]
//   --except keeps listed skill names parked (defaults to curated.keepParkedConversational).
// Logs written to unpark-skills.log next to this script.
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const KEY = 'disable-model-invocation: true';
const FALLBACK_EXCEPT = ["grill-me","grill-with-docs","wait-what","ask-matt","to-questionnaire","teach","loop-me"];

const args = process.argv.slice(2);
const opt = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };

const here = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = opt('--dir') || process.env.ABILITY_ROUTER_SKILLS_DIR || join(homedir(), '.dsh', 'skills');
const CURATED = opt('--list') || join(here, '..', 'data', 'curated.json');

let except = FALLBACK_EXCEPT;
const exceptArg = opt('--except');
if (exceptArg) {
  except = exceptArg.split(',').map((s) => s.trim()).filter(Boolean);
} else if (existsSync(CURATED)) {
  try {
    const c = JSON.parse(readFileSync(CURATED, 'utf8'));
    if (Array.isArray(c.keepParkedConversational)) except = c.keepParkedConversational;
  } catch { /* fall through to fallback */ }
}

const log = join(here, 'unpark-skills.log');
const lines = [];
let changed = 0, skipped = 0, failed = 0;

function frontmatterName(s) {
  const fm = s.split('---')[1] ?? '';
  return fm.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? null;
}

if (!existsSync(SKILLS_DIR)) {
  console.error('skills dir not found: ' + SKILLS_DIR + ' (pass --dir or set ABILITY_ROUTER_SKILLS_DIR)');
  process.exit(1);
}

for (const entry of readdirSync(SKILLS_DIR)) {
  const d = join(SKILLS_DIR, entry);
  let st; try { st = statSync(d); } catch { continue; }
  if (!st.isDirectory()) continue;
  const p = join(d, 'SKILL.md');
  if (!existsSync(p)) continue;
  let s = '';
  try { s = readFileSync(p, 'utf8'); } catch { continue; }
  const name = frontmatterName(s) ?? entry;
  if (except.includes(name)) { lines.push('KEEP(parked by design) ' + name); skipped++; continue; }
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const arr = s.split('\n');
  const kept = arr.filter((l) => l.trim() !== KEY);
  if (kept.length === arr.length) { lines.push('SKIP(no key) ' + name); skipped++; continue; }
  writeFileSync(p, kept.join('\n'), 'utf8');
  lines.push('RESTORED ' + name + ' (' + entry + ')');
  changed++;
}
lines.push('SUMMARY changed=' + changed + ' skipped=' + skipped + ' failed=' + failed);
writeFileSync(log, lines.join('\n') + '\n', 'utf8');
console.log('changed=' + changed + ' skipped=' + skipped + ' failed=' + failed + ' log=' + log);
