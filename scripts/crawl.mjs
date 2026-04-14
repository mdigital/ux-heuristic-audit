#!/usr/bin/env node
// Crawl + capture for ux-heuristic-audit skill.
// Usage: node crawl.mjs <url> [--max-pages N] [--out DIR] [--auth-storage-state PATH]

import { chromium } from 'playwright';
import { XMLParser } from 'fast-xml-parser';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
if (!args[0] || args[0].startsWith('--')) {
  console.error('Usage: crawl.mjs <url> [--max-pages N] [--out DIR] [--auth-storage-state PATH]');
  process.exit(1);
}
const rootUrl = args[0];
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const maxPages = parseInt(flag('--max-pages', '10'), 10);
const origin = new URL(rootUrl).origin;
const host = new URL(rootUrl).hostname;
const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const outDir = path.resolve(flag('--out', `./ux-audit-${host}-${today}`));
const storageState = flag('--auth-storage-state', null);
const overrideQuery = flag('--search-query', null);

const STOPWORDS = new Set('the a an and or of to in for on with by from is are be as it your our you we this that these those at if not no all any new home page site web welcome menu search login sign signup register contact about us'.split(/\s+/));
function deriveQuery(samples) {
  if (overrideQuery) return overrideQuery;
  const text = samples.filter(Boolean).join(' ').toLowerCase();
  if (!text.trim()) return 'help';
  const freq = new Map();
  for (const w of text.match(/[a-z][a-z\-]{3,}/g) || []) {
    if (STOPWORDS.has(w)) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([w]) => w);
  return top.join(' ') || 'help';
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const log = (m) => console.log(`[crawl] ${m}`);

const slug = (u) => {
  const p = new URL(u).pathname.replace(/\/$/, '') || '/index';
  return p.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'index';
};

async function tryFetch(u) {
  try {
    const r = await fetch(u, { headers: { 'user-agent': UA }, redirect: 'follow' });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
}

async function discoverFromSitemap() {
  const candidates = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  const robots = await tryFetch(`${origin}/robots.txt`);
  if (robots) {
    for (const line of robots.split('\n')) {
      const m = line.match(/^\s*sitemap:\s*(\S+)/i);
      if (m) candidates.push(m[1]);
    }
  }
  const parser = new XMLParser({ ignoreAttributes: false });
  const urls = new Set();
  for (const sm of candidates) {
    const xml = await tryFetch(sm);
    if (!xml) continue;
    const data = parser.parse(xml);
    const pickLocs = (node) => {
      if (!node) return;
      const items = Array.isArray(node) ? node : [node];
      for (const it of items) if (it?.loc) urls.add(typeof it.loc === 'string' ? it.loc : it.loc['#text']);
    };
    pickLocs(data?.urlset?.url);
    const sitemaps = data?.sitemapindex?.sitemap;
    if (sitemaps) {
      const arr = Array.isArray(sitemaps) ? sitemaps : [sitemaps];
      for (const s of arr.slice(0, 5)) {
        const sub = await tryFetch(s.loc);
        if (!sub) continue;
        pickLocs(parser.parse(sub)?.urlset?.url);
      }
    }
    if (urls.size) break;
  }
  return [...urls].filter((u) => u.startsWith(origin));
}

async function discoverFromNav(browser) {
  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();
  await page.goto(rootUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.href));
  await ctx.close();
  return [...new Set(hrefs.filter((h) => h.startsWith(origin)))];
}

function rankAndSelect(urls) {
  const want = [
    { tag: 'homepage', test: (u) => new URL(u).pathname === '/' },
    { tag: 'listing', test: (u) => /\/(products|blog|articles|shop|catalog|collections|posts|news|resources)(\/|$)/i.test(u) && u.split('/').length <= 6 },
    { tag: 'detail', test: (u) => /\/(products?|post|articles?|blog)\/[^/]+/i.test(u) },
    { tag: 'form', test: (u) => /\/(contact|signup|register|login|subscribe)/i.test(u) },
    { tag: 'search', test: (u) => /\/search/i.test(u) || /\?.*q=/.test(u) },
    { tag: 'about', test: (u) => /\/(about|team|company)/i.test(u) },
    { tag: 'help', test: (u) => /\/(help|docs|support|faq)/i.test(u) },
    { tag: 'pricing', test: (u) => /\/(pricing|plans)/i.test(u) },
  ];
  urls = [rootUrl, ...urls.filter((u) => u !== rootUrl)];
  const tpl = (u) => new URL(u).pathname.replace(/\/[^/]{8,}$/i, '/:id').replace(/\/\d+/g, '/:n');
  const seenTpl = new Set();
  const picked = [];
  const tags = new Set();
  for (const cat of want) {
    const hit = urls.find((u) => cat.test(u) && !seenTpl.has(tpl(u)));
    if (hit) { picked.push({ url: hit, tag: cat.tag }); seenTpl.add(tpl(hit)); tags.add(cat.tag); }
  }
  for (const u of urls) {
    if (picked.length >= maxPages) break;
    const t = tpl(u);
    if (seenTpl.has(t)) continue;
    seenTpl.add(t);
    picked.push({ url: u, tag: 'extra' });
  }
  picked.push({ url: `${origin}/__ux_audit_404_check_${Date.now()}`, tag: '404' });
  return picked.slice(0, maxPages);
}

async function captureDomOutline(page) {
  return page.evaluate(() => {
    const take = (sel, fn) => [...document.querySelectorAll(sel)].slice(0, 30).map(fn);
    const t = (el) => (el?.innerText || el?.getAttribute('aria-label') || '').trim().slice(0, 120);
    return {
      title: document.title,
      lang: document.documentElement.lang || null,
      landmarks: take('header,nav,main,footer,aside,[role=banner],[role=navigation],[role=main],[role=contentinfo]', (e) => ({ tag: e.tagName.toLowerCase(), role: e.getAttribute('role'), text: t(e) })),
      headings: take('h1,h2,h3', (e) => ({ level: e.tagName, text: t(e) })),
      forms: take('form', (f) => ({
        action: f.getAttribute('action'),
        method: f.getAttribute('method') || 'get',
        fields: [...f.querySelectorAll('input,select,textarea')].slice(0, 20).map((i) => ({
          name: i.name, type: i.type || i.tagName.toLowerCase(), required: i.required, autocomplete: i.autocomplete, label: (document.querySelector(`label[for="${i.id}"]`)?.innerText || i.getAttribute('aria-label') || i.placeholder || '').trim().slice(0, 80),
        })),
      })),
      buttonSample: take('button,[role=button]', (e) => t(e)).filter(Boolean),
      linkSample: take('a[href]', (a) => ({ href: a.getAttribute('href'), text: t(a) })).filter((l) => l.text),
      helpSignals: {
        hasSearch: !!document.querySelector('input[type=search],[role=search]'),
        hasBreadcrumb: !!document.querySelector('[aria-label*="breadcrumb" i],nav.breadcrumb,.breadcrumbs'),
        hasSkipLink: !!document.querySelector('a[href^="#"][class*="skip" i]'),
      },
    };
  });
}

async function capturePage(browser, { url, tag }, viewport, screenshotDir, searchQuery) {
  const isMobile = viewport === 'mobile';
  const ctx = await browser.newContext({
    userAgent: UA,
    viewport: isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: isMobile ? 2 : 1,
    storageState: storageState || undefined,
  });
  const page = await ctx.newPage();
  const consoleErrors = [];
  const failedRequests = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('requestfailed', (r) => failedRequests.push({ url: r.url(), reason: r.failure()?.errorText }));

  let status = null;
  try {
    const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    status = resp?.status() ?? null;
  } catch {
    try { const resp = await page.goto(url, { waitUntil: 'load', timeout: 30000 }); status = resp?.status() ?? null; } catch { status = 0; }
  }
  await page.waitForTimeout(1500);

  const s = slug(url);
  const base = `${s}.${viewport}`;
  await page.screenshot({ path: path.join(screenshotDir, `${base}.png`), fullPage: true });
  await page.screenshot({ path: path.join(screenshotDir, `${base}.fold.png`), fullPage: false });

  let dom = null, ax = null, axe = null;
  try { dom = await captureDomOutline(page); } catch {}
  try { ax = await page.accessibility.snapshot(); } catch {}
  if (!isMobile) {
    try { const r = await new AxeBuilder({ page }).analyze(); axe = { violations: r.violations, passes: r.passes.length }; } catch (e) { axe = { error: String(e) }; }
  }

  const probes = {};
  if (!isMobile) {
    // Search probe: fill the first search input and submit, screenshot results.
    try {
      const searchLoc = page.locator('input[type="search"], [role="search"] input, input[name*="search" i], input[name="q"], input[placeholder*="search" i]').first();
      if (await searchLoc.count()) {
        await searchLoc.fill(searchQuery);
        await Promise.race([
          page.waitForNavigation({ waitUntil: 'networkidle', timeout: 8000 }).catch(() => {}),
          searchLoc.press('Enter'),
        ]);
        await page.waitForTimeout(2000);
        const searchPath = path.join(screenshotDir, `${base}.search.png`);
        await page.screenshot({ path: searchPath, fullPage: true });
        probes.search = { query: searchQuery, resultUrl: page.url(), screenshot: `screenshots/${base}.search.png` };
      }
    } catch (e) { probes.search = { error: String(e.message).slice(0, 200) }; }

    // Re-load the page before the form probe (search may have navigated away).
    try { await page.goto(url, { waitUntil: 'load', timeout: 15000 }); await page.waitForTimeout(1000); } catch {}

    // Empty-form probe: submit the first non-search form with at least one required field.
    try {
      const formHandle = await page.evaluateHandle(() => {
        for (const f of document.querySelectorAll('form')) {
          const isSearch = f.getAttribute('role') === 'search' || f.querySelector('input[type=search]') || /search/i.test(f.className + ' ' + (f.getAttribute('action') || ''));
          if (isSearch) continue;
          if (f.querySelector('input:required, select:required, textarea:required, [aria-required="true"]')) return f;
        }
        return null;
      });
      if (formHandle && await formHandle.asElement()) {
        const submitBtn = await formHandle.asElement().$('button[type=submit], input[type=submit], button:not([type])');
        if (submitBtn) {
          await submitBtn.click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(1500);
          const formPath = path.join(screenshotDir, `${base}.emptyform.png`);
          await page.screenshot({ path: formPath, fullPage: true });
          probes.emptyForm = { screenshot: `screenshots/${base}.emptyform.png` };
        }
      }
    } catch (e) { probes.emptyForm = { error: String(e.message).slice(0, 200) }; }

    // Keyboard focus trace: first 10 Tab stops and whether a visible focus ring appears.
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 15000 });
      await page.waitForTimeout(800);
      const trace = [];
      for (let i = 0; i < 10; i++) {
        await page.keyboard.press('Tab');
        const info = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          const rect = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return {
            tag: el.tagName.toLowerCase(),
            text: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('value') || '').trim().slice(0, 80),
            href: el.getAttribute('href'),
            visible: rect.width > 0 && rect.height > 0 && cs.visibility !== 'hidden',
            outline: cs.outlineStyle !== 'none' && cs.outlineWidth !== '0px',
            boxShadow: cs.boxShadow !== 'none',
          };
        });
        trace.push(info);
      }
      const focusPath = path.join(screenshotDir, `${base}.focus.png`);
      await page.screenshot({ path: focusPath, fullPage: false });
      probes.keyboard = {
        stops: trace,
        anyFocusIndicator: trace.some((t) => t && (t.outline || t.boxShadow)),
        screenshot: `screenshots/${base}.focus.png`,
      };
    } catch (e) { probes.keyboard = { error: String(e.message).slice(0, 200) }; }
  }

  await ctx.close();
  return { url, tag, viewport, status, slug: s, screenshots: { full: `screenshots/${base}.png`, fold: `screenshots/${base}.fold.png` }, dom, ax, axe, probes, consoleErrors, failedRequests };
}

(async () => {
  await mkdir(outDir, { recursive: true });
  const shotDir = path.join(outDir, 'screenshots');
  await mkdir(shotDir, { recursive: true });
  const dataDir = path.join(outDir, 'data');
  await mkdir(dataDir, { recursive: true });

  log(`discovering pages for ${rootUrl}`);
  let urls = await discoverFromSitemap();
  log(`sitemap yielded ${urls.length} urls`);
  if (urls.length < 5) {
    const browser = await chromium.launch();
    const navUrls = await discoverFromNav(browser);
    await browser.close();
    urls = [...new Set([...urls, ...navUrls])];
    log(`nav fallback added urls, total ${urls.length}`);
  }
  const selected = rankAndSelect(urls);
  log(`selected ${selected.length} pages to audit`);

  const browser = await chromium.launch();

  // Derive search query from homepage meta/title/h1 (unless --search-query overrides).
  let searchQuery = overrideQuery;
  try {
    const sniff = await browser.newContext({ userAgent: UA });
    const sp = await sniff.newPage();
    await sp.goto(rootUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const sig = await sp.evaluate(() => ({
      title: document.title || '',
      desc: document.querySelector('meta[name="description"]')?.content || '',
      ogDesc: document.querySelector('meta[property="og:description"]')?.content || '',
      h1: [...document.querySelectorAll('h1, h2')].slice(0, 5).map((h) => h.innerText).join(' '),
    }));
    await sniff.close();
    searchQuery = deriveQuery([sig.title, sig.desc, sig.ogDesc, sig.h1]);
    log(`search query: "${searchQuery}"${overrideQuery ? ' (override)' : ' (derived from site)'}`);
  } catch (e) {
    searchQuery = overrideQuery || 'help';
    log(`could not derive query, using "${searchQuery}"`);
  }

  const results = [];
  for (const p of selected) {
    log(`capturing ${p.tag}: ${p.url}`);
    for (const vp of ['desktop', 'mobile']) {
      try {
        const r = await capturePage(browser, p, vp, shotDir, searchQuery);
        await writeFile(path.join(dataDir, `${r.slug}.${vp}.json`), JSON.stringify(r, null, 2));
        results.push(r);
      } catch (e) {
        log(`FAIL ${p.url} (${vp}): ${e.message}`);
        results.push({ url: p.url, tag: p.tag, viewport: vp, error: String(e) });
      }
    }
  }
  await browser.close();

  const manifest = { root: rootUrl, host, date: new Date().toISOString(), maxPages, searchQuery, pages: results };
  await writeFile(path.join(outDir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2));
  log(`wrote ${path.join(outDir, 'MANIFEST.json')}`);
})();
