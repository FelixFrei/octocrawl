import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { projectDir, walkFiles, mirrorPath, dirExists, isUpToDate } from './util.js';

export async function extract(slug, opts = {}) {
  const force = !!opts.force;
  const htmlDir = join(projectDir(slug), 'html');
  const outDir = join(projectDir(slug), 'readable');

  if (!(await dirExists(htmlDir))) {
    throw new Error(`extract: ${htmlDir} does not exist (run scrape first)`);
  }

  let count = 0;
  let failed = 0;
  let skipped = 0;
  for await (const file of walkFiles(htmlDir, '.html')) {
    const out = mirrorPath(file, htmlDir, outDir);
    if (!force && (await isUpToDate(file, out))) {
      skipped++;
      continue;
    }
    const html = await readFile(file, 'utf8');
    try {
      const dom = new JSDOM(html, { url: 'https://local/' });
      const article = new Readability(dom.window.document).parse();
      if (!article || !article.content) {
        failed++;
        console.warn(`[extract skip] ${file}`);
        continue;
      }
      await mkdir(dirname(out), { recursive: true });
      const body = `<!doctype html>\n<html><head><meta charset="utf-8"><title>${escapeHtml(article.title ?? '')}</title></head><body>\n<h1>${escapeHtml(article.title ?? '')}</h1>\n${article.content}\n</body></html>\n`;
      await writeFile(out, body);
      count++;
      console.log(`[extract ${count}] ${out}`);
    } catch (err) {
      failed++;
      console.warn(`[extract error] ${file}: ${err.message}`);
    }
  }
  const skipNote = skipped ? `, ${skipped} up-to-date` : '';
  console.log(`\n[extract] Wrote ${count} files to ${outDir} (${failed} failed${skipNote})`);
  return outDir;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
