# Examples

ScrapeKit ships with reproducible examples that do **not** contact third-party
websites. They use a small local HTTP fixture server so you can run them
anywhere.

## `local-fixture.ts`

Demonstrates the programmatic (library) API: inspect a page, extract links,
and run a conservative same-origin crawl — all against a local server.

```bash
npx tsx examples/local-fixture.ts
```

## CLI examples

After `npm run build` (or `npm link`):

```bash
# Inspect a single public page.
node dist/cli/index.js inspect https://example.com

# Extract all <h1> text.
node dist/cli/index.js extract https://example.com --selector "h1"

# Extract all anchor hrefs as JSON.
node dist/cli/index.js extract https://example.com --selector "a" --attr "href" --format json

# Crawl up to 5 same-origin pages, depth 1, 1s delay, save as JSON.
node dist/cli/index.js crawl https://example.com \
  --max-pages 5 --depth 1 --delay-ms 1000 --format json --output results.json

# Same crawl, exported as CSV.
node dist/cli/index.js crawl https://example.com \
  --max-pages 5 --depth 1 --delay-ms 1000 --format csv --output results.csv
```

## Crawling your own local server

If you run a fixture server on `127.0.0.1`, pass `--allow-private` so ScrapeKit
does not block the loopback address (this is the default safety guard against
SSRF):

```bash
node dist/cli/index.js crawl http://127.0.0.1:3000/ --allow-private --max-pages 5
```
