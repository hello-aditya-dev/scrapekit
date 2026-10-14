# Security Policy

ScrapeKit is a developer tool for extracting data from **publicly accessible**
web pages. This policy explains how to report vulnerabilities and what
scraping behaviors ScrapeKit will and will not support.

## Supported versions

ScrapeKit is pre-1.0 and actively developed on the `main` branch. Security fixes
are applied to the latest `main` release.

## Reporting a vulnerability

If you discover a security vulnerability in ScrapeKit, please report it
responsibly:

1. **Do not** open a public GitHub issue for the vulnerability.
2. Email the maintainer via the GitHub account's security advisory, or open a
   private [GitHub Security Advisory](https://github.com/hello-aditya-dev/scrapekit/security/advisories/new).
3. Include a clear description, a minimal reproduction, and the impact.

Please allow a reasonable window (typically up to 14 days) for an initial
response before any public disclosure. We will acknowledge receipt and work
with you on a fix and coordinated disclosure.

## Scope

In scope:

- Vulnerabilities that cause ScrapeKit to behave unsafely for the **operator**
  (e.g. SSRF bypasses, crashes, code execution, data corruption).
- Incorrect handling of redirects, private-address blocking, or `robots.txt`
  that could cause unintended traffic.

Out of scope (by design):

- Helping a user bypass `robots.txt`, CAPTCHAs, authentication, rate limits,
  or any website access control. ScrapeKit intentionally does not implement
  evasion techniques and will not add them.
- A website choosing to block ScrapeKit, or ScrapeKit's requests being served
  different content. That is the site operator's prerogative.
- Self-remediation of the above.

## Built-in safety defaults

ScrapeKit ships with conservative defaults to protect both operators and target
sites:

- **Private/loopback addresses are blocked** by default to prevent SSRF.
  Operators must opt in explicitly (`--allow-private`) for local testing.
- **`robots.txt` is respected** by default. Disallowed paths are not crawled.
- **Polite delays and bounded concurrency** are enforced with conservative
  defaults.
- **Permanent client errors (`403`, `404`, …) are not retried** — only
  transient failures (`429`, `5xx`, timeouts, network errors).
- A **descriptive User-Agent** identifies the tool and links to this
  repository.

If you believe any of these defaults can be circumvented, please report it via
the private channels above.
