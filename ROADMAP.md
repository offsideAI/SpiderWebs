# SpiderWebs — Roadmap

A breakdown of the [PRD](./PRD.md) into **Epics → Stories → Tasks**, with current status.
This is the single source of truth for "what's done / what's next". Keep it in sync as work lands.

## Legend

- `[✅]` — done and tested
- `[🟡]` — partial / in progress (what's missing is noted inline)
- `[ ]` — not started

References like `§5.2` point at PRD sections; `M1`–`M6` are the PRD §14 milestones.

## Status snapshot (2026-06-16)

| Epic | Status |
| --- | --- |
| 1. Foundation & skeleton | ✅ done |
| 2. Ingestion | 🟡 core done; `--full`, `--manifest`, ignore-file, default-branch API pending |
| 3. Dependency / SCA scanning | 🟡 npm/pnpm/yarn + OSV done; other ecosystems, SBOM, full dep paths pending |
| 4. Vuln data & enrichment | 🟡 OSV done; NVD / EPSS / KEV not started |
| 5. Risk scoring & prioritization | ⬜ not started |
| 6. Secret / code / license scanning | ⬜ not started |
| 7. GitHub issue correlation | ⬜ not started |
| 8. Agent harness | ⬜ not started |
| 9. Reporting & output formats | 🟡 TUI done; JSON/Markdown/SARIF/HTML not started |
| 10. CLI & exit codes | 🟡 shell + config/version done; `scan`/`report`/`sbom`/`db` are stubs |
| 11. TUI / UX | ✅ core done (export/open actions are stubs) |
| 12. Caching, performance & reliability | 🟡 retry/concurrency done; on-disk cache & `db update` not started |
| 13. Security & privacy of the tool | ✅ done for shipped surface |
| 14. Testing & quality | 🟡 unit/integration/TUI done; differential & snapshot pending |
| 15. Packaging & distribution | ⬜ not started |

Headline gap: the deterministic engine works and is exercised by the **TUI**, but it is **not yet
wired into the `spiderwebs` CLI**, and there are **no file report formats** — so the "scriptable CI"
half of the vision (§2, §16) is not yet reachable.

---

## Epic 1 — Foundation & Project Skeleton (M0) ✅

### Story 1.1 — Monorepo & toolchain ✅
- [✅] pnpm workspaces, strict ESM TypeScript, shared `tsconfig.base.json`
- [✅] eslint (flat) + prettier, `pnpm check` gate
- [✅] vitest configured (runs against TS sources)
- [✅] tsup build for apps

### Story 1.2 — `@spiderwebs/schema` (zod types) ✅
- [✅] `Component`, `Advisory`, `Finding` (discriminated union), `Correlation`, `Report`, `RunEvent`
- [✅] `Severity` + `FailOn` ladders, severity ranks
- [✅] Content-derived **stable finding ids** for diffable reports
- [✅] Schema unit tests

### Story 1.3 — `@spiderwebs/config` ✅
- [✅] cosmiconfig loader (`.spiderwebsrc`, `package.json` key, etc.)
- [✅] Precedence: CLI > env > file > defaults
- [✅] Secrets only from env (`GITHUB_TOKEN`, `NVD_API_KEY`, `ANTHROPIC_API_KEY`)
- [✅] Reject secret-like keys found in config files
- [✅] Config unit tests
- [ ] `.ts` config file support (`spiderwebs.config.ts`) — deferred (needs TS loader)

### Story 1.4 — `@spiderwebs/core` ✅
- [✅] Typed event bus (validates events on emit)
- [✅] pino logging with token redaction (stderr)
- [✅] Exit-code policy (0 clean / 1 findings≥threshold / 2 error)
- [✅] Subpath exports (`/bus`, `/exit`) so consumers avoid the logger
- [✅] Unit tests (bus, exit, logging)

---

## Epic 2 — Ingestion (§5.1)

### Story 2.1 — Target resolution & workspace 🟡 (M1)
- [✅] Accept `https://`, `git@`, `org/repo` shorthand, local path, `.git` URLs
- [✅] Shallow clone (`--depth 1`) into temp workspace
- [✅] Cleanup on exit, `--keep` to retain
- [✅] `--ref <branch|tag>` pin (clone `--branch`)
- [ ] `--full` history clone (needed for git-history secret scan)
- [ ] `--ref <sha>` (arbitrary commit) support
- [ ] Detect default branch via host API (currently uses clone default)

### Story 2.2 — Scope & safety 🟡 (M1)
- [✅] `--subdir <path>` scoping
- [✅] Manifest discovery walker (depth-bounded, skips `node_modules`/`.git`)
- [✅] Path-traversal / zip-slip guard (`resolveWithin`)
- [✅] Never executes repo code / install scripts
- [ ] `--manifest <file>` single-lockfile scoping
- [ ] `.spiderwebsignore` (gitignore syntax) support

---

## Epic 3 — Dependency / SCA Scanning (§5.2)

### Story 3.1 — Lockfile parsers → dependency graph 🟡 (M1–M2)
- [✅] npm (`package-lock.json` v1/v2/v3, `npm-shrinkwrap.json`)
- [✅] pnpm (`pnpm-lock.yaml` v5/v6/v9)
- [✅] yarn (`yarn.lock` v1 + Berry)
- [✅] Normalized `Component[]` with direct/transitive flag, scope, purl
- [✅] De-duplication (prefer direct record)
- [🟡] Dependency paths — only a 1-element approximate path today; full transitive path reconstruction pending
- [ ] Python (`requirements*.txt`, `poetry.lock`, `Pipfile.lock`, `pyproject.toml`)
- [ ] Go (`go.mod`, `go.sum`)
- [ ] Rust (`Cargo.lock`)
- [ ] Java (`pom.xml`, `*.gradle`, `gradle.lockfile`) — best-effort
- [ ] Ruby (`Gemfile.lock`)
- [ ] PHP (`composer.lock`)

### Story 3.2 — OSV vulnerability lookup ✅ (M1)
- [✅] Batched `POST /v1/querybatch` (chunked ≤1000, index-aligned)
- [✅] Per-advisory detail fetch with in-memory cache + concurrency limit
- [✅] zod-validated responses at the boundary
- [✅] First-fixed-version extraction per affected package
- [✅] Severity from GHSA `database_specific.severity`; CWE ids captured
- [✅] Map OSV → `Advisory` / `DependencyFinding` with stable id
- [✅] Graceful "source unavailable" degradation (no whole-run failure)

### Story 3.3 — SBOM emit ⬜ (M2)
- [ ] CycloneDX SBOM generation (`@cyclonedx/cyclonedx-library`)
- [ ] `spiderwebs sbom <target>` and `scan --sbom out.json`

---

## Epic 4 — Vulnerability Data & Enrichment (§5.7, §6)

### Story 4.1 — OSV backbone ✅
- [✅] OSV as the primary, ecosystem-aware matcher (GHSA included via OSV)

### Story 4.2 — NVD enrichment ⬜ (M2)
- [ ] NVD 2.0 client (`/rest/json/cves/2.0`) behind an interface
- [ ] CVSS v3.1/v4.0 vector + base score onto advisories
- [ ] CWE enrichment / reconciliation
- [ ] Respect rate limits (`NVD_API_KEY` aware)

### Story 4.3 — EPSS enrichment ⬜ (M2)
- [ ] FIRST EPSS client (`/data/v1/epss?cve=…`, batched)
- [ ] Attach probability + percentile to findings

### Story 4.4 — CISA KEV ⬜ (M2)
- [ ] Fetch & cache the KEV JSON feed (daily)
- [ ] Flag known-exploited findings (★) + ransomware-use flag

---

## Epic 5 — Risk Scoring & Prioritization (§5.7) ⬜ (M2)

### Story 5.1 — Composite SpiderWebs Risk Score ⬜
- [ ] Documented formula (severity + EPSS + KEV + direct/transitive + fix-availability)
- [ ] Populate `Finding.riskScore` and sort by it (KEV + high-EPSS first)
- [ ] Methodology appendix in the report

### Story 5.2 — Reachability hint (best-effort) ⬜
- [ ] Direct-dep + affected-symbol-imported coarse signal (clearly labeled)

---

## Epic 6 — Secret / Code / License Scanning

### Story 6.1 — Secret scanner ⬜ (§5.3, M6)
- [ ] Regex + entropy rules, allowlist support
- [ ] Tree scan + git-history scan (`--full`)
- [ ] Redacted output (rule + location + last 4 chars)

### Story 6.2 — Lightweight code-risk signals ⬜ (§5.4, M6)
- [ ] Per-language risky-pattern heuristics (eval, child_process, TLS-off, weak crypto, SQL concat)
- [ ] Clearly labeled low-confidence; no taint analysis

### Story 6.3 — License scanner & policy ⬜ (§5.5, M6)
- [ ] Detect declared license per dependency
- [ ] Policy (deny/warn) with config-driven lists

---

## Epic 7 — GitHub Issue Correlation (§5.6) ⬜ (M4)

### Story 7.1 — GitHub integration ⬜
- [ ] Octokit wrapper: repo metadata, default branch, issues (auth via `GITHUB_TOKEN`)
- [ ] Security-issue prefilter (labels + keyword heuristics)

### Story 7.2 — Correlation engine ⬜
- [ ] Issue → finding (issue describes an already-surfaced CVE)
- [ ] Issue → code (latent risk, no CVE, mapped to files/symbols)
- [ ] Correlation table with confidence + rationale (conservative)

---

## Epic 8 — Agent Harness (§5.8, §9) ⬜ (M5)

### Story 8.1 — Provider interface ⬜
- [ ] `LLMProvider` interface + Anthropic implementation (tool use)
- [ ] Mock provider for tests (canned tool-call transcripts)

### Story 8.2 — Read-only tool contract ⬜
- [ ] `get_findings`, `get_dependency_path`, `read_repo_file` (sandboxed, size-capped),
      `search_code`, `get_issue` / `list_security_issues`, `get_advisory`, `get_fix_versions`

### Story 8.3 — Reasoning outputs & guardrails ⬜
- [ ] Executive summary + per-finding narrative
- [ ] Grounded, ordered **patch plan** (every claim cites a finding/issue id)
- [ ] System prompt + code guard forbidding exploit/offensive output (with a refusal test)
- [ ] Per-run token/USD budget + deterministic fallback
- [ ] `--no-source-to-llm` mode

---

## Epic 9 — Reporting & Output Formats (§5.9)

### Story 9.1 — Report model ✅
- [✅] `Report` object assembled by `runScan` (summary, components, findings, data-source status)
- [✅] Stable finding ids for cross-run diffing

### Story 9.2 — File renderers ⬜ (M1–M2)
- [ ] JSON report to stdout/file (`--json`)
- [ ] Markdown renderer (default file output)
- [ ] SARIF 2.1.0 renderer (GitHub code scanning)
- [ ] HTML (self-contained) renderer
- [ ] `report` subcommand re-renders a saved JSON report

### Story 9.3 — Baseline diffing ⬜ (M6)
- [ ] `--baseline <report.json>` to diff findings across runs

---

## Epic 10 — CLI & Exit Codes (§5.10)

### Story 10.1 — Command shell ✅ (M0)
- [✅] `commander` app: `scan`, `report`, `sbom`, `db update`, `config`, `version`
- [✅] `config` prints resolved config + secret availability
- [✅] `version` works
- [✅] Global flags declared (`--quiet`, `--verbose`, `--no-color`, `--ci`, `--config`)

### Story 10.2 — Wire the engine into the CLI 🟡 (M1) — **highest-value next step**
- [🟡] `--fail-on` exit-code logic exists in core, but `scan` is a stub (not wired end-to-end)
- [ ] `spiderwebs scan <target>` runs `runScan` and writes a report
- [ ] `--json`, `--out <dir>`, `--sbom <file>` honored
- [ ] `report` subcommand un-stubbed
- [ ] `sbom` subcommand un-stubbed
- [ ] `--quiet`/`--verbose`/`--ci` behavior fully honored on the scan path

---

## Epic 11 — TUI / UX (§8) ✅

### Story 11.1 — Views & streaming ✅
- [✅] Scan-progress view (stages, spinners, live counters, source status)
- [✅] Findings explorer (master/detail, advisory detail, dependency path)
- [✅] Patch-plan view (grouped upgrades, risk badges)
- [✅] Live streaming from the shared event bus
- [✅] Interactive target prompt when no target is supplied

### Story 11.2 — Interaction ✅
- [✅] View switching (`tab`, `1/2/3`), selection (`↑↓`/`j`/`k`)
- [✅] Severity filter (`f`), fuzzy search (`/`), help overlay (`?`), quit (`q`)
- [🟡] `o` open advisory URL — shows a toast, does not actually open a browser
- [🟡] `e` export / `c` copy — toast only, no file/clipboard write yet
- [ ] KEV / ecosystem filters (only severity filter today)

### Story 11.3 — Graceful degradation ✅
- [✅] Non-TTY / piped output → plain headless rendering
- [✅] `SPIDERWEBS_TUI_HEADLESS=1` forces headless
- [✅] EPIPE-safe (clean exit when piped to `head`/`less`)

---

## Epic 12 — Caching, Performance & Reliability (§6, §11)

### Story 12.1 — Network resilience 🟡
- [✅] Bounded concurrency (`p-limit`) + retry/backoff (`p-retry`) on OSV
- [✅] Degrade gracefully if a source is down (mark unavailable)
- [ ] Token-bucket rate limiter per source
- [ ] ETag / Last-Modified honoring where supported

### Story 12.2 — On-disk cache & `db update` ⬜ (M2)
- [ ] Disk cache under `~/.spiderwebs/cache` keyed by package@version + source
- [ ] `spiderwebs db update` refreshes KEV/EPSS/OSV snapshots
- [ ] `--offline` reads from cache (today it just skips OSV → zero findings)
- [ ] Deterministic, reproducible runs from a pinned snapshot

---

## Epic 13 — Security & Privacy of the Tool (§12) ✅

- [✅] Treat scanned repos as untrusted; never execute code/build/install
- [✅] Parse manifests as data only
- [✅] Sandbox file reads to the workspace; traversal/zip-slip guard
- [✅] Secrets only from env; never logged (redaction in place)
- [✅] Clean up temp clones on exit
- [ ] Source-minimization to LLM (`--no-source-to-llm`) — blocked on Epic 8
- [ ] Redact secrets in output — blocked on Epic 6 (secret scanner)

---

## Epic 14 — Testing & Quality (§13)

### Story 14.1 — Implemented ✅
- [✅] Parser unit tests against real lockfile fixtures
- [✅] OSV mapping + client tests with an injectable fake fetch
- [✅] Orchestrator integration test (local fixture repo, OSV-found / offline / source-down / fatal paths)
- [✅] TUI tests via `ink-testing-library` (views + key handling)
- [✅] schema + config unit tests

### Story 14.2 — Pending ⬜
- [ ] Differential parity test vs `osv-scanner` (≥95% on fixtures) — §2/§16 acceptance
- [ ] Snapshot tests for Markdown / SARIF renderers (blocked on Epic 9)
- [ ] Agent loop / budget / guardrail-refusal tests (blocked on Epic 8)
- [ ] Seeded multi-ecosystem fixture repos with known CVEs
- [ ] Stabilize the occasionally-flaky Ink timing test

---

## Epic 15 — Packaging & Distribution ⬜ (M6)

- [ ] Single-file binary (SEA / `pkg`) for CLI and/or TUI
- [ ] README + usage docs polish; `TESTING.md` manual test guide
- [ ] Published `spiderwebs` bin

---

## Milestone rollup (PRD §14)

| Milestone | Scope | Status |
| --- | --- | --- |
| **M0** — Skeleton | workspaces, schema, config, CLI shell, logging | ✅ done |
| **M1** — Deterministic SCA MVP | ingest, npm/pnpm/yarn, OSV, JSON report, `--fail-on`, fixtures, differential test | 🟡 engine ✅ (via TUI); **CLI wiring, JSON report, differential test pending** |
| **M2** — Enrichment + ecosystems + formats | NVD/EPSS/KEV + risk score; Python/Go/Rust; Markdown/SARIF; SBOM; cache + `db update` | ⬜ not started |
| **M3** — TUI | Ink dashboard, 3 views, streaming, filters/search/export | ✅ done (export action is a stub) |
| **M4** — GitHub issue correlation | Octokit, prefilter, issue↔finding↔code | ⬜ not started |
| **M5** — Agent harness | LLMProvider, tool contract, guardrails, patch-plan narrative, budget | ⬜ not started |
| **M6** — Polish | secrets, code, license, HTML, `--baseline`, packaging, docs | ⬜ not started |

## Recommended next push

Finish **M1 as a shippable CLI** (Epic 10 Story 10.2 + Epic 9 Story 9.2): wire `runScan` into
`spiderwebs scan` with `--fail-on`/`--json`/`--out`, and add JSON + SARIF + Markdown renderers.
That makes the tool usable in CI and clears most of the §16 acceptance criteria. The natural
follow-on is **Epic 4 + 5** (NVD/EPSS/KEV enrichment + risk score), since the TUI already renders
those fields.
