// Pre-publish privacy audit for this repo — zero dependencies, no install.
// Usage: node scripts/prepublish-check.mjs
// Exit code 0 = clean, 1 = findings that must be fixed before publishing.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);
const SKIP_FILES = /(\.log$|\.lock$)/;

const RULES = [
  ['绝对用户路径', /(C:[\\/]Users[\\/]|\/home\/[a-z]|\/Users\/[A-Z])/i],
  ['邮箱地址', /[\w.+-]+@[\w-]+\.[a-z]{2,}/i],
  ['密钥/令牌', new RegExp('(' + ['gh' + 'p_', 'gh' + 'o_', 'github' + '_pat_', 'sk-' + '[A-Za-z0-9]{16,}', 'AK' + 'IA[0-9A-Z]{16}', 'xo' + 'x[baprs]-', '-----BEGIN [A-Z ]*PRIVATE KEY-----'].join('|') + ')')],
  ['疑似手机号', /(?<!\d)1[3-9]\d{9}(?!\d)/],
  ['内网地址', /(\b10\.\d+\.\d+\.\d+|\b192\.168\.\d+\.\d+|\b172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)/],
];

// 个人上下文文件：会话笔记、agent 产物、临时目录
const CONTEXT_FILES = /(handoff|session[-_]?notes?|run[-_]?history|scratch|diary|\.claude\/|TODO\.md$|notes\.md$)/i;

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) { if (!SKIP_DIRS.has(e)) walk(p, out); }
    else if (!SKIP_FILES.test(e)) out.push(p);
  }
  return out;
}

const findings = [];
const files = walk(ROOT);

// 1) 内容规则
for (const f of files) {
  const rel = relative(ROOT, f).replace(/\\/g, '/');
  if (rel === 'scripts/prepublish-check.mjs') continue; // the scanner itself
  if (CONTEXT_FILES.test(rel)) {
    findings.push({ sev: 'HIGH', file: rel, line: 0, rule: '个人上下文文件', text: rel });
  }
  let txt = '';
  try { txt = readFileSync(f, 'utf8'); } catch { continue; }
  if (txt.includes('\u0000')) continue; // binary
  txt.split('\n').forEach((line, i) => {
    for (const [rule, re] of RULES) {
      const m = line.match(re);
      if (m) findings.push({ sev: rule === '密钥/令牌' ? 'CRITICAL' : 'HIGH', file: rel, line: i + 1, rule, text: m[0].slice(0, 60) });
    }
  });
}

// 2) .gitignore 覆盖
const giPath = join(ROOT, '.gitignore');
const gi = existsSync(giPath) ? readFileSync(giPath, 'utf8') : '';
const NEEDED = ['.env', '*.pem', '*.key', 'credentials.json', 'node_modules/', '*.log'];
const missing = NEEDED.filter((n) => !gi.includes(n));

// 3) 私有配置文件是否被误提交（存在但未 ignore）
const PRIVATE = ['data/abilities.local.json', 'data/curated.json'];
const notIgnored = PRIVATE.filter((p) => existsSync(join(ROOT, p)) && !gi.includes(p.split('/').pop()));

const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
findings.sort((a, b) => order[a.sev] - order[b.sev]);

console.log('=== Pre-publish privacy audit ===');
console.log('scanned ' + files.length + ' files\n');

if (findings.length === 0) {
  console.log('No personal data found in tracked files.');
} else {
  for (const f of findings) {
    console.log('[' + f.sev + '] ' + f.file + (f.line ? ':' + f.line : '') + '  ' + f.rule + '  ->  ' + f.text);
  }
}
if (missing.length) console.log('\n[MEDIUM] .gitignore missing: ' + missing.join(', '));
if (notIgnored.length) console.log('[HIGH] private config exists but not gitignored: ' + notIgnored.join(', '));

const blocking = findings.filter((f) => f.sev === 'CRITICAL' || f.sev === 'HIGH').length + notIgnored.length;
console.log('\nVerdict: ' + (blocking === 0 ? 'CLEAN — safe to publish' : blocking + ' blocking finding(s)'));
process.exit(blocking === 0 ? 0 : 1);
