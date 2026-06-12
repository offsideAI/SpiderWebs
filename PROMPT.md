---
You are building "SpiderWebs", a CLI-first + TUI, agentic DEFENSIVE security auditor for
remote Git repositories, in pure TypeScript. A full PRD is in ./PRD.md — treat it as the
source of truth and follow its section numbers. Read it before writing code.

SCOPE & ETHOS (non-negotiable):
- This is a DEFENSIVE tool. It detects KNOWN vulnerabilities and recommends patches/upgrades.
- It must NEVER generate exploit code, attack payloads, or weaponized PoCs — not in source,
  not in tests, not in the agent's outputs. The agent's system prompt and a code-level guard
  must enforce this.
- Treat every scanned repository as UNTRUSTED input: never execute repo code, run its install
  scripts, or build it. Parse manifests as data only. Sandbox all file reads to the cloned
  workspace and protect against path traversal / zip-slip.
- Never read API tokens from config files or log them; tokens come only from env vars
  (GITHUB_TOKEN, NVD_API_KEY, ANTHROPIC_API_KEY).

TECH BASELINE:
- TypeScript, Node >= 20, ESM, "strict": true. Monorepo (pnpm workspaces or npm workspaces)
  with the package layout in PRD §7.1.
- CLI: commander. TUI: Ink (+ ink-spinner, ink-table, ink-text-input). Git: isomorphic-git
  OR simple-git behind an adapter interface. GitHub: @octokit/rest + @octokit/graphql.
  Schemas/validation: zod. SBOM: @cyclonedx/cyclonedx-library. LLM: @anthropic-ai/sdk behind
  an LLMProvider interface. Config: cosmiconfig. Logging: pino. Tests: vitest + msw/nock.
  Build: tsup; single-file binary via SEA or pkg. Use latest stable versions; pin them.
- A single typed event bus in packages/core is the one source of truth; both the TUI and the
  headless/JSON renderers consume the same events so output is always consistent.
- The deterministic core (ingest -> parse -> vulndb lookup -> enrich -> correlate -> report)
  must work and be fully tested WITHOUT any LLM. The agent is an optional additive layer; if
  ANTHROPIC_API_KEY is absent or --no-agent is set, produce the deterministic report.

VULN DATA (PRD §6) — correctness matters:
- Use OSV.dev batched queries (POST /v1/querybatch) as the backbone for all ecosystems; it is
  ecosystem-aware and does version-range matching and includes GHSA. Do NOT string-match CVE
  IDs against package names. Then enrich matched CVEs with NVD 2.0 (CVSS/CWE), EPSS (FIRST),
  and CISA KEV (single JSON feed). Cache everything on disk under ~/.spiderwebs/cache; support
  `spiderwebs db update` and `--offline`. Respect rate limits (token bucket + p-retry backoff);
  if a source is down, mark it unavailable in the report rather than failing the whole run.

BUILD INCREMENTALLY — implement and STOP for review after each milestone. After each, run the
build + tests, show me what works, and summarize what's next. Do not skip ahead.

  Milestone 0 — Skeleton: workspaces, packages/schema with zod types (Component, Finding,
  Advisory, Correlation, Report, RunEvent), config loader, commander CLI shell with `scan`,
  `report`, `sbom`, `db update`, `config`, `version` stubs, pino logging, exit-code plumbing
  (0 clean / 1 findings>=threshold / 2 error). Tests for schema + config.

  Milestone 1 — Deterministic SCA MVP: ingest (shallow clone, temp workspace, cleanup, ref +
  subdir scoping, traversal-safe); npm/pnpm/yarn parsers -> normalized DependencyGraph (direct
  + transitive, dependency paths); OSV batched lookup with version-range matching + first-fixed-
  version extraction; JSON report; `--fail-on`. Fixtures: at least two seeded vulnerable repos
  with known CVEs; assert exact findings. Add a differential test comparing dep-vuln output to
  osv-scanner on fixtures (>=95% parity target).

  Milestone 2 — Enrichment + ecosystems + formats: NVD/EPSS/KEV merge + documented SpiderWebs
  Risk Score (PRD §5.7); add Python, Go, Rust (and best-effort Java/Ruby/PHP) parsers; Markdown
  + SARIF 2.1.0 renderers; CycloneDX SBOM emit; on-disk cache + `db update` + `--offline`.
  Snapshot tests for Markdown/SARIF.

  Milestone 3 — TUI: Ink app with the three views in PRD §8 (Scan progress, Findings explorer,
  Patch plan), live streaming from the event bus, severity/KEV filters, fuzzy search, export,
  graceful degradation to --ci on dumb terminals / NO_COLOR. ink-testing-library tests.

  Milestone 4 — GitHub issue correlation: Octokit wrapper (repo meta, default branch, issues),
  security-issue prefiltering, issue<->finding<->code correlation with confidence (PRD §5.6).

  Milestone 5 — Agent harness: LLMProvider interface + Anthropic implementation using tool use;
  the READ-ONLY tool contract in PRD §9 (get_findings, read_repo_file [sandboxed, size-capped],
  search_code, get_issue, get_advisory, get_fix_versions); a system prompt that constrains the
  agent to defensive analysis and explicitly forbids exploit/offensive output; per-run token/USD
  budget with deterministic fallback; outputs = exec summary + per-finding narrative +
  grounded, ordered PATCH PLAN, every claim referencing a finding/issue id. Tests use a mock
  provider returning canned tool-call transcripts; assert the loop, budget enforcement, and a
  guardrail refusal case.

  Milestone 6 — Polish: secret scanner (regex+entropy, redacted output, optional git-history
  with --full), lightweight pattern-based code-risk signals (clearly labeled low-confidence,
  no taint analysis), license scanner + policy, HTML report, `--baseline` diffing, binary
  packaging, README + usage docs.

CODING STANDARDS:
- Strict TS, no `any` in public APIs; validate all external/API data with zod at boundaries.
- Pure, testable functions in packages/*; side effects (network, fs, clone) behind interfaces
  so they can be mocked. Bounded concurrency (p-limit) and retries (p-retry) on all network IO.
- Deterministic output given a pinned cache (stable sort, stable finding ids) so reports diff
  cleanly. Helpful errors; never leak tokens. eslint + prettier clean.

Start with Milestone 0: propose the exact dependency versions and the workspace/package file
tree, then scaffold it and implement the schema + config + CLI shell with passing tests. Stop
and show me before Milestone 1.
