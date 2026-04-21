import { chromium } from 'playwright';
import { mkdir, writeFile, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { projectDir, slugFromUrl } from './util.js';
import { fetchRobots, parseRobots, isAllowed } from './robots.js';

const USER_AGENT = 'octocrawl/0.1 (+https://github.com/)';

export async function scrape(startUrlArg, opts = {}) {
  if (!startUrlArg) throw new Error('scrape: start URL required');
  const startUrl = new URL(startUrlArg);
  const slug = slugFromUrl(startUrlArg);
  const projDir = projectDir(slug);
  const htmlDir = join(projDir, 'html');
  const statePath = join(projDir, '.state.json');
  const prefix = startUrl.origin + startUrl.pathname.replace(/\/+$/, '');

  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const retries = opts.retries ?? 2;
  const pageTimeoutMs = opts.pageTimeoutMs ?? 20_000;
  const fresh = !!opts.fresh;
  const delayMs = Math.max(0, opts.delayMs ?? 0);
  const ignoreRobots = !!opts.ignoreRobots;

  if (fresh) {
    await rm(statePath, { force: true });
  }

  let robotsRules = { disallow: [], allow: [] };
  if (!ignoreRobots) {
    const txt = await fetchRobots(startUrl.origin, USER_AGENT);
    if (txt !== null) {
      robotsRules = parseRobots(txt, USER_AGENT);
      console.log(`[scrape] robots.txt: ${robotsRules.disallow.length} disallow, ${robotsRules.allow.length} allow rules for ${USER_AGENT}`);
    } else {
      console.log(`[scrape] no robots.txt found at ${startUrl.origin} (proceeding)`);
    }
  }

  const robotsOk = (u) => {
    if (ignoreRobots) return true;
    try {
      return isAllowed(new URL(u).pathname, robotsRules);
    } catch {
      return true;
    }
  };

  const visited = new Set();
  const queue = [];
  const saved = await loadState(statePath, startUrl.href);
  if (saved) {
    for (const u of saved.visited) visited.add(u);
    const candidates = saved.queue.filter((u) => !visited.has(u));
    const allowed = candidates.filter(robotsOk);
    if (allowed.length !== candidates.length) {
      console.log(`[scrape] robots.txt excluded ${candidates.length - allowed.length} URLs from resumed queue`);
    }
    queue.push(...allowed);
    console.log(`[scrape] Resuming: ${visited.size} visited, ${queue.length} queued`);
  } else {
    if (!robotsOk(startUrl.href)) {
      throw new Error(`scrape: start URL ${startUrl.href} is disallowed by robots.txt (use --ignore-robots to override)`);
    }
    queue.push(startUrl.href);
  }

  const urlToFilePath = (u) => {
    const p = new URL(u);
    let rel = p.pathname;
    if (rel.endsWith('/')) rel += 'index';
    if (!rel.match(/\.[a-z0-9]+$/i)) rel += '.html';
    return join(htmlDir, rel);
  };

  const normalize = (u) => {
    try {
      const parsed = new URL(u, startUrl);
      parsed.hash = '';
      return parsed.href;
    } catch {
      return null;
    }
  };

  const inScope = (u) => u.startsWith(prefix);

  let activeCount = 0;
  let saveChain = Promise.resolve();
  const inFlight = new Set();

  function dequeue() {
    while (queue.length) {
      const url = queue.shift();
      if (visited.has(url) || inFlight.has(url)) continue;
      inFlight.add(url);
      activeCount++;
      return url;
    }
    return null;
  }

  function snapshotState() {
    return {
      startUrl: startUrl.href,
      prefix,
      visited: [...visited],
      queue: [...inFlight, ...queue],
    };
  }

  function scheduleSave() {
    saveChain = saveChain
      .then(() => saveState(statePath, snapshotState()))
      .catch((err) => console.warn(`[scrape] save state failed: ${err.message}`));
    return saveChain;
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({ userAgent: USER_AGENT });

  let processed = 0;
  let failed = 0;

  const stop = async () => {
    console.log('\n[scrape] Interrupted — saving state...');
    await saveState(statePath, { startUrl: startUrl.href, prefix, visited: [...visited], queue });
    await browser.close().catch(() => {});
    process.exit(130);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  async function processPage(page, url) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: pageTimeoutMs });
        await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => {});
        if (!response) throw new Error('no response');
        if (!response.ok()) {
          console.warn(`[scrape skip] ${url} -> ${response.status()}`);
          visited.add(url);
          return;
        }

        const html = await page.content();
        const file = urlToFilePath(url);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, html);
        visited.add(url);
        processed++;
        console.log(`[scrape ${processed}] ${url}`);

        const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')));
        for (const href of hrefs) {
          const abs = normalize(href);
          if (!abs) continue;
          if (!inScope(abs)) continue;
          if (!robotsOk(abs)) continue;
          if (visited.has(abs)) continue;
          if (inFlight.has(abs)) continue;
          if (queue.includes(abs)) continue;
          queue.push(abs);
        }
        return;
      } catch (err) {
        lastErr = err;
        if (attempt < retries) {
          const backoff = 500 * 2 ** attempt;
          console.warn(`[scrape retry ${attempt + 1}] ${url} (${err.message}) — waiting ${backoff}ms`);
          await new Promise((r) => setTimeout(r, backoff));
        }
      }
    }
    failed++;
    console.warn(`[scrape error] ${url}: ${lastErr?.message}`);
  }

  async function worker() {
    const page = await context.newPage();
    try {
      while (true) {
        const url = dequeue();
        if (!url) {
          if (activeCount === 0 && queue.length === 0) return;
          await new Promise((r) => setTimeout(r, 50));
          continue;
        }
        try {
          await processPage(page, url);
        } finally {
          inFlight.delete(url);
          activeCount--;
          scheduleSave();
        }
        if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      }
    } finally {
      await page.close().catch(() => {});
    }
  }

  try {
    const workers = Array.from({ length: concurrency }, () => worker());
    await Promise.all(workers);
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    await scheduleSave();
    await browser.close();
  }

  console.log(`\n[scrape] Done — ${processed} saved, ${failed} failed, ${visited.size} visited total → ${htmlDir}`);
  return slug;
}

async function loadState(path, expectedStartUrl) {
  try {
    const raw = await readFile(path, 'utf8');
    const state = JSON.parse(raw);
    if (state.startUrl !== expectedStartUrl) return null;
    return state;
  } catch {
    return null;
  }
}

async function saveState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
  await writeFile(tmp, JSON.stringify(state));
  await rename(tmp, path);
}
