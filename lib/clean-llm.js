import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { projectDir, walkFiles, mirrorPath, dirExists } from './util.js';

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
  const model = opts.model ?? 'claude-haiku-4-5';

  if (!(await dirExists(mdDir))) {
    throw new Error(`clean: ${mdDir} does not exist (run markdown first)`);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('clean: ANTHROPIC_API_KEY env var required');
  }

  const client = new Anthropic();

  let count = 0;
  let failed = 0;
  for await (const file of walkFiles(mdDir, '.md')) {
    const md = await readFile(file, 'utf8');
    if (!md.trim()) continue;
    try {
      const response = await client.messages.create({
        model,
        max_tokens: 8192,
        system: [
          {
            type: 'text',
            text: SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: md }],
      });
      const cleaned = response.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      const out = mirrorPath(file, mdDir, outDir);
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, cleaned);
      count++;
      const usage = response.usage;
      const cacheInfo = usage.cache_read_input_tokens
        ? ` (cache: ${usage.cache_read_input_tokens} read)`
        : usage.cache_creation_input_tokens
          ? ` (cache: ${usage.cache_creation_input_tokens} write)`
          : '';
      console.log(`[clean ${count}] ${out}${cacheInfo}`);
    } catch (err) {
      failed++;
      console.warn(`[clean error] ${file}: ${err.message}`);
    }
  }
  console.log(`\n[clean] Wrote ${count} files to ${outDir} (${failed} failed)`);
  return outDir;
}
