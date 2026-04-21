import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

export function slugFromUrl(urlStr) {
  const u = new URL(urlStr);
  const path = u.pathname.replace(/\/+$/, '').replace(/\//g, '_');
  return u.hostname + path;
}

export function projectDir(slug) {
  return join('output', slug);
}

export async function* walkFiles(dir, ext) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      yield* walkFiles(full, ext);
    } else if (!ext || e.name.endsWith(ext)) {
      yield full;
    }
  }
}

export async function dirExists(p) {
  try {
    const s = await stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

export async function isUpToDate(srcFile, dstFile) {
  try {
    const [srcStat, dstStat] = await Promise.all([stat(srcFile), stat(dstFile)]);
    return dstStat.mtimeMs >= srcStat.mtimeMs;
  } catch {
    return false;
  }
}

export async function newestMtime(dir, ext) {
  let newest = 0;
  for await (const file of walkFiles(dir, ext)) {
    const s = await stat(file);
    if (s.mtimeMs > newest) newest = s.mtimeMs;
  }
  return newest;
}

export async function oldestMtime(dir, ext) {
  let oldest = Infinity;
  let any = false;
  for await (const file of walkFiles(dir, ext)) {
    const s = await stat(file);
    any = true;
    if (s.mtimeMs < oldest) oldest = s.mtimeMs;
  }
  return any ? oldest : null;
}

export function mirrorPath(srcFile, srcRoot, dstRoot, replaceExt) {
  const rel = relative(srcRoot, srcFile);
  const out = join(dstRoot, rel);
  if (replaceExt) {
    return out.replace(/\.[a-z0-9]+$/i, replaceExt);
  }
  return out;
}

export function resolveSlug(arg) {
  if (!arg) throw new Error('Missing slug or URL');
  if (arg.startsWith('http://') || arg.startsWith('https://')) {
    return slugFromUrl(arg);
  }
  return arg;
}
