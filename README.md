# octocrawl

Pipeline zum Herunterladen und Aufbereiten von Webseiten mit Playwright.

Vier Stufen: **scrape → extract → markdown → clean**. Jede Stufe kann einzeln oder per `all` in einem Rutsch ausgeführt werden. Die Stufen schreiben in separate Unterordner, damit Zwischenergebnisse reproduzierbar bleiben.

## Installation

```bash
npm install
npx playwright install chromium
```

## Pipeline

| Stage      | Tool                              | Eingabe           | Ausgabe                  |
|------------|-----------------------------------|-------------------|--------------------------|
| `scrape`   | Playwright (Chromium, headless)   | Start-URL         | `output/<slug>/html/`    |
| `extract`  | Mozilla Readability + JSDOM       | `html/`           | `output/<slug>/readable/`|
| `markdown` | Turndown                          | `readable/`       | `output/<slug>/md/`      |
| `clean`    | Heuristik (Block-Dedup) _oder_ Claude API | `md/`     | `output/<slug>/md-cleaned/` |

- **scrape** läuft BFS über alle Links mit demselben URL-Präfix wie die Start-URL (keine externen Seiten, keine Nachbar-Repos).
- **extract** zieht den Hauptinhalt heraus (Artikel-Body, keine Navigation).
- **markdown** konvertiert den extrahierten HTML-Body zu Markdown.
- **clean** entfernt wiederkehrende Blöcke, die auf mehreren Seiten identisch vorkommen (Header, Footer, "Relevant source files", Trennlinien usw.). Der LLM-Modus macht dasselbe mit Claude, falls die Heuristik nicht reicht.

## Nutzung

```bash
# Alles in einem Aufruf
node cli.js all https://example.com/docs

# Mit Clean-Schritt
node cli.js all https://example.com/docs --clean

# Einzelne Stufen (per URL oder per slug)
node cli.js scrape   https://example.com/docs
node cli.js extract  https://example.com/docs
node cli.js markdown example.com_docs
node cli.js clean    example.com_docs

# Heuristik-Schwelle anpassen (default 0.5 = Block in ≥50% der Seiten)
node cli.js clean example.com_docs --threshold 0.3

# LLM-Cleanup statt Heuristik
ANTHROPIC_API_KEY=sk-ant-... node cli.js clean example.com_docs --llm
```

Der `slug` wird automatisch aus Host + Pfad der Start-URL abgeleitet (`deepwiki.com/zeroclaw-labs/zeroclaw` → `deepwiki.com_zeroclaw-labs_zeroclaw`). Subbefehle akzeptieren sowohl die volle URL als auch den Slug.

## Ausgabestruktur

```
output/<slug>/
├── html/         # rohes Playwright-HTML (nach JS-Rendering)
├── readable/     # Hauptinhalt via Readability
├── md/           # Markdown via Turndown
└── md-cleaned/   # Markdown ohne seitenübergreifende Boilerplate
```

Die interne Verzeichnisstruktur spiegelt den URL-Pfad, sodass man jede Datei der Ursprungs-URL zuordnen kann.

## Voraussetzungen

- Node.js ≥ 18 (ESM + `node:fs/promises`)
- Chromium (wird via `npx playwright install chromium` bezogen)
- Optional: `ANTHROPIC_API_KEY` für `clean --llm` (Modell: `claude-haiku-4-5`, mit Prompt-Caching auf dem System-Prompt)
