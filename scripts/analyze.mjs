#!/usr/bin/env node
// Aggregate axe results + run Lighthouse on homepage.
// Usage: node analyze.mjs --out DIR

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const pExec = promisify(execFile);
const args = process.argv.slice(2);
const outDir = path.resolve(args[args.indexOf('--out') + 1] || '.');
const log = (m) => console.log(`[analyze] ${m}`);

const manifest = JSON.parse(await readFile(path.join(outDir, 'MANIFEST.json'), 'utf8'));

// Aggregate axe violations across pages.
const dataDir = path.join(outDir, 'data');
const files = (await readdir(dataDir)).filter((f) => f.endsWith('.desktop.json'));
const axeByPage = {};
const ruleCounts = {};
for (const f of files) {
  const j = JSON.parse(await readFile(path.join(dataDir, f), 'utf8'));
  if (!j.axe?.violations) continue;
  axeByPage[j.url] = j.axe.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length }));
  for (const v of j.axe.violations) ruleCounts[v.id] = (ruleCounts[v.id] || 0) + v.nodes.length;
}

// Run Lighthouse on homepage.
log('running lighthouse on homepage...');
let lighthouse = null;
try {
  const lhPath = path.join(outDir, 'lighthouse.json');
  await pExec('npx', ['--yes', 'lighthouse', manifest.root, '--quiet', '--chrome-flags=--headless=new', '--output=json', `--output-path=${lhPath}`, '--only-categories=performance,accessibility,best-practices,seo'], { maxBuffer: 64 * 1024 * 1024 });
  const lh = JSON.parse(await readFile(lhPath, 'utf8'));
  lighthouse = {
    scores: Object.fromEntries(Object.entries(lh.categories).map(([k, v]) => [k, v.score])),
    metrics: {
      LCP: lh.audits['largest-contentful-paint']?.displayValue,
      CLS: lh.audits['cumulative-layout-shift']?.displayValue,
      TBT: lh.audits['total-blocking-time']?.displayValue,
      FCP: lh.audits['first-contentful-paint']?.displayValue,
    },
  };
} catch (e) {
  log(`lighthouse failed: ${e.message}`);
  lighthouse = { error: String(e.message).slice(0, 500) };
}

const summary = {
  generated: new Date().toISOString(),
  host: manifest.host,
  pagesAudited: [...new Set(manifest.pages.filter((p) => !p.error).map((p) => p.url))].length,
  lighthouse,
  axe: {
    topRules: Object.entries(ruleCounts).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([id, count]) => ({ id, count })),
    byPage: axeByPage,
  },
};
await writeFile(path.join(outDir, 'analysis-summary.json'), JSON.stringify(summary, null, 2));
log(`wrote ${path.join(outDir, 'analysis-summary.json')}`);
