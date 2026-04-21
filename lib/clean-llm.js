import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { projectDir, walkFiles, mirrorPath, dirExists, isUpToDate } from './util.js';

const SYSTEM_PROMPT = `You clean up scraped web-page markdown for archival.

Your job:
- Remove navigation menus, breadcrumbs, footers, cookie banners, "share this" widgets.
- Remove repeated site chrome, login prompts, and calls-to-action.
- Preserve the main article/content verbatim: headings, paragraphs, lists, code blocks, tables, links.
- Keep the original structure and wording. Do not summarize, paraphrase, or add commentary.
- Output only the cleaned markdown, with no preamble or explanation.`;

export async function cleanLlm(slug, opts = {}) {
  const mdDir = join(projectDir(slug), 'md');
  const outDir = join(projectDir(slug), 'md-cleaned');
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
  const baseUrl = (opts.baseUrl ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = opts.model ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const force = !!opts.force;

  if (!(await dirExists(mdDir))) {
    throw new Error(`clean: ${mdDir} does not exist (run markdown first)`);
  }
  if (!apiKey) {
    throw new Error('clean: OPENAI_API_KEY env var required');
  }

  const jobs = [];
  for await (const file of walkFiles(mdDir, '.md')) {
    const out = mirrorPath(file, mdDir, outDir);
    if (!force && (await isUpToDate(file, out))) continue;
    jobs.push({ file, out });
  }

  let cursor = 0;
  let count = 0;
  let failed = 0;

  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= jobs.length) return;
      const { file, out } = jobs[idx];
      const md = await readFile(file, 'utf8');
      if (!md.trim()) continue;
      try {
        const cleaned = await chatCompletion({ apiKey, baseUrl, model, userContent: md });
        await mkdir(dirname(out), { recursive: true });
        await writeFile(out, cleaned);
        count++;
        console.log(`[clean ${count}/${jobs.length}] ${out}`);
      } catch (err) {
        failed++;
        console.warn(`[clean error] ${file}: ${err.message}`);
      }
    }
  }

  console.log(`[clean] ${jobs.length} files to process via ${baseUrl} (model=${model}, concurrency=${concurrency})`);
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  console.log(`\n[clean] Wrote ${count} files to ${outDir} (${failed} failed)`);
  return outDir;
}

async function chatCompletion({ apiKey, baseUrl, model, userContent }) {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error(`unexpected response shape: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return content;
}
