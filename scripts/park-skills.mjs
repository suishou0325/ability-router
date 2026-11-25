// Park long-tail skills: add disable-model-invocation: true to their frontmatter.
// Idempotent. Matches skills by frontmatter "name" (NOT directory name), so it
// works regardless of how skill folders are organized on disk.
//
// Usage: node park-skills.mjs [--dir <skills-dir>] [--list <curated.json>]
//   <skills-dir> defaults to env ABILITY_ROUTER_SKILLS_DIR, then ~/.dsh/skills.
//   <curated.json> defaults to ../data/curated.json next to this script.
// Logs written to park-skills.log next to this script.
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const KEY = 'disable-model-invocation: true';

const args = process.argv.slice(2);
const opt = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };

const here = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = opt('--dir') || process.env.ABILITY_ROUTER_SKILLS_DIR || join(homedir(), '.dsh', 'skills');
const CURATED = opt('--list') || join(here, '..', 'data', 'curated.json');

if (!existsSync(CURATED)) {
  console.error('curated list not found: ' + CURATED);
  console.error('Copy data/curated.example.json to data/curated.json and edit keep/drop lists for your machine.');
  process.exit(1);
}
const curated = JSON.parse(readFileSync(CURATED, 'utf8'));
const DROP_NAMES = curated.drop ?? [];
const DROP_DIRS = curated.dropDirs ?? [];
const KEEP_NAMES = curated.keep ?? [];

const log = join(here, 'park-skills.log');
const lines = [];
let changed = 0, skipped = 0, failed = 0;

function frontmatterName(s) {
  const fm = s.split('---')[1] ?? '';
  return fm.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? null;
}

function addKey(p, label) {
  let s = readFileSync(p, 'utf8');
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (s.includes(KEY)) { lines.push('SKIP(has key) ' + label); skipped++; return; }
  s = s.endsWith('\n') ? s : s + '\n';
  const arr = s.split('\n');
  let count = 0, end = -1;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i].trim() === '---') { count++; if (count === 2) { end = i; break; } }
  }
  if (end === -1) { lines.push('ERROR(no 2nd ---) ' + label); failed++; return; }
  arr.splice(end, 0, KEY);
  writeFileSync(p, arr.join('\n'), 'utf8');
  lines.push('PARKED ' + label);
  changed++;
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
  let content = '';
  try { content = readFileSync(p, 'utf8'); } catch { continue; }
  const name = frontmatterName(content);
  if (!name) continue;
  if (KEEP_NAMES.includes(name)) continue;
  const matched = DROP_NAMES.includes(name) || DROP_DIRS.includes(entry);
  if (matched) addKey(p, name + ' (' + entry + ')');
}
lines.push('SUMMARY changed=' + changed + ' skipped=' + skipped + ' failed=' + failed);
writeFileSync(log, lines.join('\n') + '\n', 'utf8');
console.log('changed=' + changed + ' skipped=' + skipped + ' failed=' + failed + ' log=' + log);
