import TurndownService from 'turndown';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';
import { projectDir, walkFiles, mirrorPath, dirExists } from './util.js';

export async function markdown(slug) {
  const readableDir = join(projectDir(slug), 'readable');
  const outDir = join(projectDir(slug), 'md');

  if (!(await dirExists(readableDir))) {
    throw new Error(`markdown: ${readableDir} does not exist (run extract first)`);
  }

  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '_',
  });

  let count = 0;
  for await (const file of walkFiles(readableDir, '.html')) {
    const html = await readFile(file, 'utf8');
    const dom = new JSDOM(html);
    const body = dom.window.document.body?.innerHTML ?? html;
    const md = turndown.turndown(body);
    const out = mirrorPath(file, readableDir, outDir, '.md');
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, md);
    count++;
    console.log(`[markdown ${count}] ${out}`);
  }
  console.log(`\n[markdown] Wrote ${count} files to ${outDir}`);
  return outDir;
}
