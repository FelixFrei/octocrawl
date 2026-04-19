import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { projectDir, walkFiles, mirrorPath, dirExists } from './util.js';

export async function clean(slug, opts = {}) {
  const threshold = opts.threshold ?? 0.5;
  const minBlockLen = opts.minBlockLen ?? 0;
  const mdDir = join(projectDir(slug), 'md');
  const outDir = join(projectDir(slug), 'md-cleaned');

  if (!(await dirExists(mdDir))) {
    throw new Error(`clean: ${mdDir} does not exist (run markdown first)`);
  }

  const files = [];
  for await (const file of walkFiles(mdDir, '.md')) {
    const content = await readFile(file, 'utf8');
    files.push({ file, content });
  }
  if (files.length === 0) {
    console.log(`[clean] No markdown files found in ${mdDir}`);
    return outDir;
  }

  const blockCounts = new Map();
  for (const f of files) {
    const seen = new Set();
    for (const block of splitBlocks(f.content)) {
      const key = normalizeBlock(block);
      if (!key) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      blockCounts.set(key, (blockCounts.get(key) ?? 0) + 1);
    }
  }

  const total = files.length;
  const minCount = Math.max(2, Math.ceil(total * threshold));
  const boilerplate = new Set();
  for (const [key, count] of blockCounts) {
    if (count >= minCount) boilerplate.add(key);
  }
  console.log(`[clean] ${files.length} files, ${blockCounts.size} unique blocks, ${boilerplate.size} flagged as boilerplate (threshold=${threshold}, minCount=${minCount})`);

  let count = 0;
  let removedTotal = 0;
  for (const f of files) {
    const blocks = splitBlocks(f.content);
    const kept = blocks.filter((b) => {
      const key = normalizeBlock(b);
      if (!key) return false;
      if (key.length < minBlockLen) return false;
      return !boilerplate.has(key);
    });
    const removed = blocks.length - kept.length;
    removedTotal += removed;

    const out = mirrorPath(f.file, mdDir, outDir);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, kept.join('\n\n').trim() + '\n');
    count++;
    console.log(`[clean ${count}] ${out} (-${removed})`);
  }
  console.log(`\n[clean] Wrote ${count} files to ${outDir} (removed ${removedTotal} boilerplate blocks total)`);
  return outDir;
}

function splitBlocks(md) {
  const out = [];
  let buf = [];
  let inFence = false;
  for (const line of md.split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (!inFence && line.trim() === '') {
      if (buf.length) { out.push(buf.join('\n').trim()); buf = []; }
    } else {
      buf.push(line);
    }
  }
  if (buf.length) out.push(buf.join('\n').trim());
  return out.filter(Boolean);
}

function normalizeBlock(block) {
  return block.replace(/\s+/g, ' ').trim().toLowerCase();
}
