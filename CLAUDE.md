# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install && npx playwright install chromium    # one-time setup

node cli.js all <url> [--clean] [--llm]           # full pipeline
node cli.js scrape <url> [--concurrency N] [--fresh]
node cli.js extract <url|slug>
node cli.js markdown <url|slug>
node cli.js clean <url|slug> [--llm] [--threshold 0..1]
```

There is no test suite, linter, or build step. `node cli.js <cmd>` is the only entry point; the `npm run` scripts are thin aliases.

The LLM cleaner posts directly to any OpenAI-compatible `/chat/completions` endpoint (via global `fetch`). Configured entirely by env: `OPENAI_API_KEY` (required), `OPENAI_BASE_URL` (default `https://api.openai.com/v1`), `OPENAI_MODEL` (default `gpt-4o-mini`). No SDK dependency.

## Architecture

Four-stage pipeline, each stage reads from the previous stage's output directory and writes to the next. Stages are independently runnable so intermediate artifacts stay reproducible.

```
scrape   → output/<slug>/html/          (Playwright Chromium, headless)
extract  → output/<slug>/readable/      (Mozilla Readability + JSDOM)
markdown → output/<slug>/md/            (Turndown)
clean    → output/<slug>/md-cleaned/    (heuristic dedup OR OpenAI-compatible LLM)
```

### Cross-cutting conventions (`lib/util.js`)

- **Slug**: derived from the start URL as `hostname + pathname` with `/` → `_` (e.g. `deepwiki.com/foo/bar` → `deepwiki.com_foo_bar`). All stages after `scrape` accept either a full URL or the slug; `resolveSlug()` normalizes.
- **Path mirroring**: `mirrorPath(srcFile, srcRoot, dstRoot, replaceExt?)` preserves the URL-path-derived directory structure across every stage, so a given source URL maps to the same relative path in `html/`, `readable/`, `md/`, and `md-cleaned/`.
- **File walking**: `walkFiles()` is a recursive async generator used by every stage downstream of `scrape`.

### Scrape invariants (`lib/scrape.js`)

- **Scope**: BFS follows only links whose absolute URL starts with `startUrl.origin + startUrl.pathname` (trailing slash stripped). Hash fragments are dropped during normalization. This keeps the crawl to sibling/descendant pages only.
- **URL → file**: paths ending `/` become `index`; paths without an extension get `.html` appended.
- **Resume**: `output/<slug>/.state.json` holds `{startUrl, prefix, visited, queue}`; it is rewritten atomically (temp file + rename) after every page and on SIGINT/SIGTERM. A subsequent `scrape` call on the same URL resumes; `--fresh` deletes the state file. State is tied to `startUrl` — a different start URL triggers a fresh crawl even if the slug collides.
- **Worker pool**: `concurrency` workers share the queue plus an `inFlight` set to prevent duplicate fetches. `activeCount` + `queue.length === 0` is the termination condition.
- **Robustness**: waits for `domcontentloaded` then `load` with a 10s fallback (never `networkidle` — it hangs on doc sites). Up to 2 retries with exponential backoff (500ms, 1s). Non-2xx responses are marked visited and skipped silently.

### Heuristic clean (`lib/clean.js`)

Splits each markdown file into blank-line-separated blocks (respecting fenced code blocks so ``` doesn't get split mid-block), normalizes each block (lowercase, whitespace collapsed), and counts cross-file occurrences. Any block appearing in ≥ `threshold` fraction of files (min 2) is treated as boilerplate and stripped. `threshold` default is 0.5 — lower it for small corpora where headers/footers don't meet the 50% bar.

### Module style

ESM (`"type": "module"`), Node ≥ 18, no TypeScript, no bundler. Each stage exports one async function named after the stage; `cli.js` is a plain switch dispatcher. Errors bubble to `cli.js` which prints `Error: <message>` and exits 1.
