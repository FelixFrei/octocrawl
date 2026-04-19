import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { projectDir, slugFromUrl } from './util.js';

export async function scrape(startUrlArg, opts = {}) {
  if (!startUrlArg) throw new Error('scrape: start URL required');
  const startUrl = new URL(startUrlArg);
  const slug = slugFromUrl(startUrlArg);
  const htmlDir = join(projectDir(slug), 'html');
  const prefix = startUrl.origin + startUrl.pathname.replace(/\/+$/, '');

  const visited = new Set();
  const queue = [startUrl.href];

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

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  let count = 0;
  try {
    while (queue.length > 0) {
      const url = queue.shift();
      if (visited.has(url)) continue;
      visited.add(url);

      try {
        const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
        if (!response || !response.ok()) {
          console.warn(`[skip] ${url} -> ${response?.status()}`);
          continue;
        }

        const html = await page.content();
        const file = urlToFilePath(url);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, html);
        count++;
        console.log(`[scrape ${count}] ${url}`);

        const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')));
        for (const href of hrefs) {
          const abs = normalize(href);
          if (!abs) continue;
          if (!inScope(abs)) continue;
          if (visited.has(abs)) continue;
          queue.push(abs);
        }
      } catch (err) {
        console.warn(`[error] ${url}: ${err.message}`);
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`\n[scrape] Saved ${count} pages to ${htmlDir}`);
  return slug;
}
