# ScrapeKit

> Extract useful data from public websites. Responsibly, reliably, and without the boilerplate.

[![CI](https://github.com/hello-aditya-dev/scrapekit/actions/workflows/ci.yml/badge.svg)](https://github.com/hello-aditya-dev/scrapekit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D18.17-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)

**ScrapeKit** is a small, production-minded Node.js + TypeScript command-line
toolkit for extracting structured information from publicly accessible web
pages. It bundles the things most scraping scripts reinvent every time — HTTP
fetching with timeouts and retries, HTML parsing with Cheerio, `robots.txt`
handling, conservative same-origin crawling, and JSON/CSV export — into one
focused, well-tested CLI and library.

It is designed to be genuinely useful and easy to evaluate: a clear CLI, safe
defaults, meaningful tests, and no inflated claims.

---

## Table of contents

- [The problem ScrapeKit solves](#the-problem-scrapekit-solves)
- [Features](#features)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Command reference](#command-reference)
  - [`scrapekit inspect`](#scrapekit-inspect)
  - [`scrapekit extract`](#scrapekit-extract)
  - [`scrapekit crawl`](#scrapekit-crawl)
- [Sample output](#sample-output)
  - [Sample JSON](#sample-json)
  - [Sample CSV](#sample-csv)
- [Programmatic usage](#programmatic-usage)
- [Architecture](#architecture)
- [Testing](#testing)
- [Responsible scraping](#responsible-scraping)
- [Known limitations](#known-limitations)
- [Contributing](#contributing)
- [License](#license)

---

## The problem ScrapeKit solves

Fetching a page and pulling a few fields out of it sounds trivial, but doing it
_reliably_ keeps requiring the same plumbing:

- HTTP requests that time out instead of hanging forever.
- Retries for transient failures, with backoff and `Retry-After` awareness.
- Handling of `429 Too Many Requests` and `403 Forbidden` without hammering the
  server.
- Following redirects safely (and not into your internal network).
- Respecting `robots.txt`.
- Parsing HTML and extracting text, attributes, and links.
- De-duplicating URLs, bounding crawl depth and page count.
- Exporting results as JSON or CSV without hand-rolling escaping.

ScrapeKit implements all of this once, behind a clean CLI and a typed library
API, with conservative defaults that won't get you blocked or accidentally crawl
your internal network.

## Features

- **HTML extraction** with [Cheerio](https://cheerio.js.org/): CSS selectors,
  text content, attributes (`href`, `src`, `content`, …), multi-match, and
  graceful handling of missing elements.
- **Responsible crawling**: same-origin BFS crawler with URL normalization,
  duplicate prevention, configurable max pages / depth / delay / concurrency,
  relative-link resolution, and `robots.txt` enforcement.
- **Reliability**: request timeouts via `AbortController`, retries with
  exponential backoff and bounded jitter, `Retry-After` support, correct
  handling of `429` (retried) and other `4xx` (not retried), and meaningful
  exit codes.
- **Structured metadata**: page title, meta description, canonical URL, grouped
  headings (`h1`–`h6`), and same-origin internal links.
- **Exports**: JSON (pretty, UTF-8) and CSV (RFC 4180 escaping, stable schema).
- **Safe defaults**: private/loopback addresses are blocked by default to
  prevent SSRF-style mistakes; a descriptive `User-Agent` identifies the tool.
- **Typed library API**: the same modules the CLI uses are exported as a stable
  TypeScript API.

ScrapeKit does **not** implement stealth browser fingerprints, CAPTCHA bypass,
credential attacks, or any technique designed to evade website security
controls. See [Responsible scraping](#responsible-scraping).

## Installation

### From source (recommended for now)

```bash
git clone https://github.com/hello-aditya-dev/scrapekit.git
cd scrapekit
npm install
npm run build
```

The compiled CLI is available at `dist/cli/index.js`. Link it globally:

```bash
npm link
scrapekit --help
```

…or run it directly:

```bash
node dist/cli/index.js --help
```

### Requirements

- Node.js `>= 18.17` (uses the global `fetch`).
- npm or a compatible package manager.

## Quick start

Inspect a single public page:

```bash
scrapekit inspect https://example.com
```

Extract every `<h1>` text from a page:

```bash
scrapekit extract https://example.com --selector "h1"
```

Extract every link's `href` as JSON:

```bash
scrapekit extract https://example.com --selector "a" --attr "href" --format json
```

Crawl up to 5 same-origin pages (depth 1, 1s delay) and save as JSON:

```bash
scrapekit crawl https://example.com \
  --max-pages 5 \
  --depth 1 \
  --delay-ms 1000 \
  --format json \
  --output results.json
```

> The crawl commands respect `robots.txt` by default. To crawl a site you run
> locally (e.g. a fixture server on `127.0.0.1`), pass `--allow-private`.

## Command reference

Run `scrapekit --help` or `scrapekit <command> --help` for the full, authoritative
list. The most useful options are summarized below.

### `scrapekit inspect`

Fetch a single public page and print its structured metadata.

```text
scrapekit inspect <url> [options]

Options:
  -s, --selector <selector>  Also extract elements matching this CSS selector.
  -a, --attr <attribute>     Extract this attribute instead of text (use with --selector).
  -f, --format <format>      Output format: json or csv. (default: "json")
  -o, --output <path>        Write output to a file instead of stdout.
  --timeout-ms <ms>          Request timeout in milliseconds. (default: 15000)
  --user-agent <ua>          Override the User-Agent string.
  --allow-private            Allow fetching private/loopback addresses (local testing).
  --max-retries <n>          Maximum retry attempts for transient failures. (default: 3)
```

### `scrapekit extract`

Extract elements matching a CSS selector from a single public page.

```text
scrapekit extract <url> --selector <css> [options]

Required:
  -s, --selector <selector>  CSS selector to match (e.g. "h1", "a", "article > p").

Options:
  -a, --attr <attribute>     Extract this attribute (e.g. "href", "src") instead of text.
  -f, --format <format>      Output format: json or csv. (default: "json")
  -o, --output <path>        Write output to a file instead of stdout.
  --timeout-ms <ms>          Request timeout in milliseconds. (default: 15000)
  --user-agent <ua>          Override the User-Agent string.
  --allow-private            Allow fetching private/loopback addresses (local testing).
  --max-retries <n>          Maximum retry attempts for transient failures. (default: 3)
```

### `scrapekit crawl`

Crawl permitted same-origin pages within conservative limits.

```text
scrapekit crawl <url> [options]

Options:
  --max-pages <n>      Maximum number of pages to visit. (default: 10)
  --depth <n>          Maximum crawl depth (seed page is depth 0). (default: 2)
  --delay-ms <ms>      Delay between requests to the same host (ms). (default: 1000)
  --concurrency <n>    Maximum concurrent in-flight requests. (default: 2)
  -f, --format <format>  Output format: json or csv. (default: "json")
  -o, --output <path>    Write output to a file instead of stdout.
  --timeout-ms <ms>    Per-request timeout in milliseconds. (default: 15000)
  --user-agent <ua>    Override the User-Agent string.
  --allow-private      Allow crawling private/loopback addresses (local testing).
  --no-robots          Do not respect robots.txt (not recommended).
  --max-retries <n>    Maximum retry attempts for transient failures. (default: 3)
```

## Sample output

### Sample JSON

`scrapekit inspect https://example.com` produces:

```json
{
  "metadata": {
    "url": "https://example.com/",
    "status": 200,
    "title": "Example Domain",
    "description": null,
    "canonical": null,
    "headings": {
      "h1": ["Example Domain"]
    },
    "internalLinks": []
  }
}
```

`scrapekit extract https://example.com --selector "a" --attr "href"` produces:

```json
{
  "url": "https://example.com/",
  "selector": "a",
  "attribute": "href",
  "items": [{ "attr": "https://www.iana.org/domains/example", "index": 0 }]
}
```

### Sample CSV

`scrapekit crawl https://example.com --max-pages 1 --depth 0 --format csv` produces
a stable, documented schema with CRLF line endings:

```csv
url,depth,status,title,description,canonical,headingCount,internalLinks,error
https://example.com/,0,200,Example Domain,,,1,0,
```

**CSV schema (crawl):**

| Column          | Type   | Notes                                               |
| --------------- | ------ | --------------------------------------------------- |
| `url`           | string | The page URL that was crawled.                      |
| `depth`         | int    | Crawl depth (seed = 0).                             |
| `status`        | int    | HTTP status code (0 if not fetched).                |
| `title`         | string | `<title>` text, empty if absent.                    |
| `description`   | string | `<meta name="description">`, empty if absent.       |
| `canonical`     | string | `<link rel="canonical">`, empty if absent.          |
| `headingCount`  | int    | Total number of `h1`–`h6` headings.                 |
| `internalLinks` | int    | Number of same-origin links discovered on the page. |
| `error`         | string | Error message if the page failed, empty otherwise.  |

**CSV schema (extract):** `url, selector, attribute, index, text, value`.

Complex fields are serialized as stable JSON strings and then CSV-escaped, so the
schema stays flat and round-trippable.

## Programmatic usage

ScrapeKit is also a typed library. The same modules the CLI uses are exported
from the package root:

```ts
import {
  fetchPage,
  extractMetadata,
  extractSelector,
  crawl,
  toJson,
  toCsv,
  ScrapeKitError,
} from 'scrapekit';

// Fetch a single page with retries and extract metadata.
const { value: doc } = await fetchPage('https://example.com/', {
  timeoutMs: 10000,
});
const meta = extractMetadata(doc.body, doc.url, { status: doc.status });
console.log(meta.title, meta.internalLinks.length);

// Extract with a CSS selector.
const items = extractSelector(doc.body, 'a', 'href');

// Run a conservative same-origin crawl.
const result = await crawl('https://example.com/', {
  maxPages: 5,
  maxDepth: 1,
  delayMs: 1000,
  concurrency: 2,
});
console.log(toJson(result));
```

Errors are typed as `ScrapeKitError` with a stable `code` (`INVALID_URL`,
`BLOCKED_PRIVATE_ADDRESS`, `TIMEOUT`, `TOO_MANY_REDIRECTS`, `HTTP_ERROR`,
`NETWORK_ERROR`, `OUTPUT_ERROR`, …) so you can react programmatically.

## Architecture

```text
src/
  cli/
    index.ts           CLI entry point (Commander)
    output.ts          shared output/summary helpers
    commands/
      inspect.ts       `scrapekit inspect`
      extract.ts       `scrapekit extract`
      crawl.ts         `scrapekit crawl`
  core/
    url.ts             URL normalization, same-origin, private-address checks
    retry.ts           exponential backoff + jitter, Retry-After awareness
    fetcher.ts         raw HTTP fetch: timeout, manual redirects, SSRF guard
    client.ts          fetcher + retry composition (fetchPage)
    robots.ts          robots.txt fetch + cache + isAllowed
    extractor.ts       Cheerio-based metadata + selector extraction
    crawler.ts         conservative same-origin BFS crawler
  exporters/
    json.ts            JSON serialization + file writer
    csv.ts             RFC 4180 CSV escaping + file writer
  types/
    index.ts           shared types and ScrapeKitError
  index.ts             public library barrel
```

Design principles:

- **Small, focused modules** with a single responsibility and clear inputs/outputs.
- **Safe defaults**: private addresses blocked, `robots.txt` respected, polite
  delays, bounded concurrency.
- **The fetcher is dumb, the policy is separate**: `fetcher.ts` does one fetch
  with timeout + redirect handling; `retry.ts` / `client.ts` layer retry policy
  on top. This keeps the failure model easy to reason about.
- **No dead code, no placeholders**: every public function has tests.

## Testing

ScrapeKit has a meaningful test suite (117 tests across 9 files) that does not
depend on third-party websites. Integration tests spin up a local HTTP fixture
server so CI is hermetic.

```bash
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
npm test            # Vitest (117 tests)
npm run build       # tsc → dist/
```

All four must pass. The suite covers:

- URL normalization, same-origin checks, private-address detection
- HTML selection, text extraction, attribute extraction, missing selectors
- CSV escaping (commas, quotes, newlines, nested objects) and JSON export
- Retry behavior, backoff bounds, `Retry-After` honoring, abort handling
- `robots.txt` allowed / disallowed paths and user-agent rules
- Fetcher timeout, 429 + `Retry-After` parsing, redirect-to-private blocking,
  too-many-redirects enforcement
- Crawler: depth enforcement, max-page enforcement, dedupe, robots blocking,
  external-origin exclusion, error recording
- End-to-end CLI tests (help, version, inspect, extract, crawl, CSV/JSON
  export, invalid-URL rejection, file-write failures) against the local fixture
  server

## Responsible scraping

ScrapeKit is built for _responsible_ extraction from _public_ pages. By design:

- It **respects `robots.txt`** by default. Disallowed paths are not crawled.
- It uses a **descriptive User-Agent** (`ScrapeKit/0.1 (+…github…)`) so site
  operators can identify and rate-limit the tool.
- It enforces **polite delays** and **bounded concurrency** with conservative
  defaults.
- It **does not retry permanent client errors** (e.g. `403`, `404`) — only
  transient failures (`429`, `5xx`, timeouts, network errors).
- It **blocks private/loopback addresses by default** to prevent accidental
  SSRF against internal services. Opt out only for local testing
  (`--allow-private`).
- It does **not** implement CAPTCHA bypass, credential attacks, browser
  fingerprint spoofing, or any technique intended to evade access controls.

Always check a site's `robots.txt` and Terms of Service, rate-limit yourself,
and avoid scraping behind authentication or in violation of applicable law.

## Known limitations

- ScrapeKit parses static HTML with Cheerio; it does **not** execute
  JavaScript. Pages that render content client-side (SPAs) will appear empty.
- Crawl scope is **same-origin only**. Cross-origin crawling is intentionally
  not supported.
- `robots.txt` is cached per origin for 30 minutes; long-running processes may
  need to call `clearRobotsCache()` to pick up changes.
- `Retry-After` as an HTTP-date is parsed best-effort.
- The tool targets publicly accessible pages; it is not a general-purpose
  authenticated crawling framework.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for
development setup, testing, and pull-request conventions, and
[SECURITY.md](./SECURITY.md) for responsible vulnerability reporting.

## License

[MIT](./LICENSE) © hello-aditya-dev
