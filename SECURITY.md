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

- **SSRF protection (two layers, best-effort):**
  1. A _syntactic_ check of the URL host that blocks IPv4/IPv6 literals in
     private ranges (RFC 1918, loopback, link-local, CGNAT, documentation,
     benchmarking), `localhost`/`*.localhost` hostnames, `0.0.0.0`, and
     IPv4-mapped IPv6 addresses.
  2. A _DNS-resolution_ check that resolves the hostname via `node:dns` and
     rejects the request if **any** returned address is non-public. This
     catches hostnames that resolve to private IPs (e.g. `internal.corp`).
     Redirects are checked at each hop. Operators must opt in explicitly
     (`--allow-private`) for local testing.
- **Response-body size limit** (5 MiB default, configurable via
  `--max-body-bytes`) to prevent memory exhaustion from oversized responses.
- **`robots.txt` is respected** by default. Disallowed paths are not crawled.
- **Polite delays and bounded concurrency** are enforced with conservative
  defaults. A dedicated rate gate ensures request _starts_ are spaced by the
  configured delay even under concurrency.
- **Permanent client errors (`403`, `404`, …) are not retried** — only
  transient failures (`429`, `5xx`, timeouts, network errors).
- A **descriptive User-Agent** identifies the tool and links to this
  repository.

### Residual SSRF risk (disclosed honestly)

The DNS check is a **time-of-check** guard. Node's `fetch` does not expose a
way to pin the resolved IP address at the socket layer, so a determined
attacker with control of an authoritative DNS server could theoretically
rebind the record between the check and the connection (DNS rebinding /
TOCTOU). The implemented controls block the overwhelming majority of accidental
and naive-malicious SSRF attempts, but this is **best-effort mitigation, not a
complete SSRF defense**. Operators running ScrapeKit against untrusted
user-supplied URLs in security-sensitive environments should layer additional
network-level controls (egress firewalls, DNS pinning proxies).

If you believe any of these defaults can be circumvented in a way that is
exploitable in practice, please report it via the private channels above.
