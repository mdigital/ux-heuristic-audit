#!/usr/bin/env node
// Render REPORT.md → report.pdf using Playwright.
// Usage: node pdf.mjs --out DIR [--input REPORT.md] [--output report.pdf]

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { marked } from 'marked';

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const outDir = path.resolve(flag('--out', '.'));
const inputName = flag('--input', 'REPORT.md');
const outputName = flag('--output', 'report.pdf');
const inputPath = path.join(outDir, inputName);
const outputPath = path.join(outDir, outputName);

const log = (m) => console.log(`[pdf] ${m}`);

const md = await readFile(inputPath, 'utf8');
marked.setOptions({ gfm: true, breaks: false });
const body = marked.parse(md);

const css = `
  @page { size: A4; margin: 18mm 16mm 20mm 16mm; }
  html { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; font-size: 10.5pt; color: #1a1a1a; }
  body { max-width: 180mm; }
  h1 { font-size: 22pt; border-bottom: 2px solid #0a5e5e; padding-bottom: 6px; margin-top: 0; page-break-after: avoid; }
  h2 { font-size: 15pt; color: #0a5e5e; margin-top: 22px; page-break-after: avoid; border-bottom: 1px solid #d5e3e3; padding-bottom: 3px; }
  h3 { font-size: 12pt; margin-top: 16px; page-break-after: avoid; }
  p, li { line-height: 1.45; }
  em { color: #555; }
  hr { border: 0; border-top: 1px solid #ccc; margin: 18px 0; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 9.5pt; page-break-inside: avoid; }
  th, td { border: 1px solid #ccc; padding: 5px 7px; text-align: left; vertical-align: top; }
  th { background: #f2f6f6; font-weight: 600; }
  code { background: #f4f4f4; padding: 1px 4px; border-radius: 3px; font-size: 9.5pt; }
  img { max-width: 100%; height: auto; border: 1px solid #ddd; border-radius: 3px; margin: 6px 0; page-break-inside: avoid; display: block; }
  /* Screenshot thumbnails stay reasonable on a printed page */
  p img, li img { max-height: 130mm; }
  /* Keep heuristic section headers + first paragraph together */
  h2 + p, h3 + p, h2 + ul, h3 + ul { page-break-before: avoid; }
  ul, ol { page-break-inside: avoid; }
  a { color: #0a5e5e; text-decoration: none; }
`;

const html = `<!doctype html><html><head><meta charset="utf-8"><title>UX Heuristic Audit</title><style>${css}</style></head><body>${body}</body></html>`;

// Write to a temp HTML file inside the out dir so relative image paths resolve.
const tmpHtml = path.join(outDir, '.report.tmp.html');
await writeFile(tmpHtml, html);

log('launching chromium...');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(tmpHtml).href, { waitUntil: 'networkidle' });
await page.pdf({
  path: outputPath,
  format: 'A4',
  printBackground: true,
  margin: { top: '18mm', right: '16mm', bottom: '20mm', left: '16mm' },
});
await browser.close();
await writeFile(tmpHtml, '');
log(`wrote ${outputPath}`);
