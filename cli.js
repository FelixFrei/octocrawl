#!/usr/bin/env node
import { scrape } from './lib/scrape.js';
import { extract } from './lib/extract.js';
import { markdown } from './lib/markdown.js';
import { clean } from './lib/clean.js';
import { cleanLlm } from './lib/clean-llm.js';
import { resolveSlug } from './lib/util.js';

const HELP = `Usage:
  octocrawl scrape <url>                    Crawl all same-prefix pages -> output/<slug>/html/
  octocrawl extract <url|slug>              Readability main content   -> output/<slug>/readable/
  octocrawl markdown <url|slug>             HTML -> markdown (Turndown) -> output/<slug>/md/
  octocrawl clean <url|slug> [--llm]        Remove repeated boilerplate -> output/<slug>/md-cleaned/
                                              default: heuristic (cross-page block deduplication)
                                              --llm:   Claude API cleanup (needs ANTHROPIC_API_KEY)
  octocrawl all <url> [--clean] [--llm]     Run scrape + extract + markdown (+ optional clean)

Flags:
  --threshold <0..1>   clean heuristic: fraction of pages a block must appear in to be boilerplate (default 0.5)

Env:
  ANTHROPIC_API_KEY    required only for 'clean --llm'`;

const [, , cmd, ...rest] = process.argv;

function parseThreshold(args) {
  const i = args.indexOf('--threshold');
  if (i < 0) return undefined;
  const v = Number(args[i + 1]);
  if (!Number.isFinite(v) || v < 0 || v > 1) throw new Error('--threshold must be between 0 and 1');
  return v;
}

try {
  switch (cmd) {
    case 'scrape':
      await scrape(rest[0]);
      break;
    case 'extract':
      await extract(resolveSlug(rest[0]));
      break;
    case 'markdown':
      await markdown(resolveSlug(rest[0]));
      break;
    case 'clean': {
      const slug = resolveSlug(rest[0]);
      const useLlm = rest.includes('--llm');
      const threshold = parseThreshold(rest);
      await (useLlm ? cleanLlm(slug) : clean(slug, { threshold }));
      break;
    }
    case 'all': {
      const url = rest[0];
      if (!url) throw new Error('all: URL required');
      const slug = await scrape(url);
      await extract(slug);
      await markdown(slug);
      if (rest.includes('--clean')) {
        const useLlm = rest.includes('--llm');
        const threshold = parseThreshold(rest);
        await (useLlm ? cleanLlm(slug) : clean(slug, { threshold }));
      }
      break;
    }
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      break;
    default:
      console.error(`Unknown command: ${cmd}\n\n${HELP}`);
      process.exit(1);
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
