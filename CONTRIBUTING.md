# Contributing to ScrapeKit

Thanks for your interest in improving ScrapeKit! This document describes how to
set up the project, run the tests, and submit changes.

## Development setup

ScrapeKit is a standard Node.js + TypeScript project.

```bash
git clone https://github.com/hello-aditya-dev/scrapekit.git
cd scrapekit
npm install
```

Requirements:

- Node.js `>= 20` (the project uses the global `fetch` and `File`).
- npm (a compatible package manager works too).

## Common scripts

```bash
npm run build        # Compile TypeScript to dist/
npm run typecheck    # Type-check without emitting
npm run lint         # ESLint
npm run format       # Prettier (write)
npm run format:check # Prettier (check only)
npm test             # Run the full Vitest suite
npm run test:watch   # Vitest in watch mode
```

A pull request is ready for review when **all four** of these pass cleanly:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Project layout

See the [Architecture](./README.md#architecture) section of the README for a
module-by-module overview. In short:

- `src/core/` — fetching, retry, robots, extraction, and crawling primitives.
- `src/exporters/` — JSON and CSV serialization.
- `src/cli/` — the `scrapekit` CLI built on Commander.
- `tests/unit/` — fast, isolated unit tests.
- `tests/integration/` — tests that spin up a local HTTP fixture server.
- `tests/fixtures/` — static HTML fixtures and the test server helper.

## Writing tests

- Prefer **unit tests** for pure logic (URL helpers, CSV escaping, retry math).
- Use the **local fixture server** (`tests/fixtures/server.ts`) for anything
  that needs HTTP. Do **not** add tests that hit real third-party websites —
  CI must be hermetic.
- Every new public function or option should have at least one test.
- Do not disable or delete a failing test to make the suite green. Fix the
  underlying issue.

## Code style

- TypeScript strict mode, no implicit `any`.
- ESM (`"type": "module"`), imports use `.js` extensions.
- Prettier + ESLint enforce formatting and linting. Run `npm run format` before
  committing.
- Keep modules small and focused. Avoid speculative abstractions.

## Submitting changes

1. Fork the repository and create a branch from `main`.
2. Write your change, including tests and docs where appropriate.
3. Ensure `lint`, `typecheck`, `test`, and `build` all pass.
4. Commit with a clear message. Keep commits focused.
5. Open a pull request describing **what** changed and **why**.

## Reporting issues

Open a GitHub issue with:

- A clear title and description.
- The ScrapeKit version and Node.js version.
- A minimal reproduction (command + expected vs. actual output).
- For crashes, the full error output and exit code.

Do **not** open issues for help bypassing `robots.txt`, CAPTCHAs, or access
controls — those are out of scope.

## Security

See [SECURITY.md](./SECURITY.md) for responsible vulnerability reporting.
