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
                                              --llm:   OpenAI-compatible chat completion (needs OPENAI_API_KEY,
                                                       optional OPENAI_BASE_URL / OPENAI_MODEL)
  octocrawl all <url> [--clean] [--llm]     Run scrape + extract + markdown (+ optional clean)

Flags:
  --concurrency <N>    scrape / clean --llm: parallel workers (default 4)
  --fresh              scrape: ignore saved state and start over
  --delay <ms>         scrape: per-worker delay between pages (default 0)
  --ignore-robots      scrape: skip robots.txt checks
  --force              extract/markdown/clean: reprocess even if outputs are up-to-date
  --threshold <0..1>   clean heuristic: fraction of pages a block must appear in to be boilerplate (default 0.5)

Env (clean --llm only):
  OPENAI_API_KEY       required
  OPENAI_BASE_URL      default https://api.openai.com/v1 (set to your provider's URL)
  OPENAI_MODEL         default gpt-4o-mini`;

const [, , cmd, ...rest] = process.argv;

function parseNumFlag(args, name, { int = false, min = 0, max = Infinity } = {}) {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = Number(args[i + 1]);
  if (!Number.isFinite(v) || v < min || v > max) throw new Error(`${name} must be a number in [${min}, ${max}]`);
  if (int && !Number.isInteger(v)) throw new Error(`${name} must be an integer`);
  return v;
}

function parseScrapeOpts(args) {
  const opts = {
    fresh: args.includes('--fresh'),
    ignoreRobots: args.includes('--ignore-robots'),
  };
  const c = parseNumFlag(args, '--concurrency', { int: true, min: 1 });
  if (c !== undefined) opts.concurrency = c;
  const d = parseNumFlag(args, '--delay', { int: true, min: 0 });
  if (d !== undefined) opts.delayMs = d;
  return opts;
}

function parseCleanOpts(args) {
  const opts = { force: args.includes('--force') };
  const t = parseNumFlag(args, '--threshold', { min: 0, max: 1 });
  if (t !== undefined) opts.threshold = t;
  const c = parseNumFlag(args, '--concurrency', { int: true, min: 1 });
  if (c !== undefined) opts.concurrency = c;
  return opts;
}

function forceOpts(args) {
  return { force: args.includes('--force') };
}

try {
  switch (cmd) {
    case 'scrape':
      await scrape(rest[0], parseScrapeOpts(rest));
      break;
    case 'extract':
      await extract(resolveSlug(rest[0]), forceOpts(rest));
      break;
    case 'markdown':
      await markdown(resolveSlug(rest[0]), forceOpts(rest));
      break;
    case 'clean': {
      const slug = resolveSlug(rest[0]);
      const useLlm = rest.includes('--llm');
      await (useLlm ? cleanLlm(slug, parseCleanOpts(rest)) : clean(slug, parseCleanOpts(rest)));
      break;
    }
    case 'all': {
      const url = rest[0];
      if (!url) throw new Error('all: URL required');
      const slug = await scrape(url, parseScrapeOpts(rest));
      await extract(slug, forceOpts(rest));
      await markdown(slug, forceOpts(rest));
      if (rest.includes('--clean')) {
        const useLlm = rest.includes('--llm');
        await (useLlm ? cleanLlm(slug, parseCleanOpts(rest)) : clean(slug, parseCleanOpts(rest)));
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
