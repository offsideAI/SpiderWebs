# SpiderWebs — Product Requirements Document (PRD)

> An agentic, CLI-first + TUI security auditor for remote Git repositories.
> Pulls a repo, performs Software Composition Analysis (SCA), cross-checks public
> vulnerability databases, correlates open GitHub issues against the code, and
> produces a prioritized, patch-aware remediation report.

**Status:** Draft v1.0
**Language:** TypeScript (Node.js ≥ 20, ESM)
**Distribution:** npm package + standalone binary
**Document owner:** _you_

---

## 1. Summary & Vision

Security scanners today (Snyk, Trivy, OSV-Scanner, Dependabot, npm audit) are excellent at
*detecting* known vulnerable dependencies, but they:

- dump raw findings with little prioritization or narrative,
- don't connect a project's **own open issues** to the surfaced risks,
- and rarely explain *what to actually do* in plain language with a concrete patch plan.

**SpiderWebs** closes that gap. It is a focused, defensive auditing tool that combines a
deterministic scanning core (manifest parsing → vulnerability DB lookups → enrichment) with
an **agent harness** (an LLM orchestrator with tools) that reasons over the raw findings,
correlates them with the repo's open GitHub issues and source, and writes a clear,
action-oriented report with a recommended patch list.

It runs as a snappy terminal UI for interactive triage *and* as a scriptable CLI for CI.

**One-line pitch:** _"Point SpiderWebs at a repo URL; get back a prioritized security report
that tells contributors exactly what's broken, why it matters, which open issues relate to it,
and the precise upgrades/patches to apply."_

### Non-goals (explicitly out of scope for v1)

- It is **not** an offensive/exploitation tool. It never generates exploit code, attack
  payloads, or weaponized PoCs. It surfaces *known* vulnerabilities and *defensive* remediation.
- Auto-fix and pull-request generation is an **opt-in, explicitly-consented** feature, never the
  default. SpiderWebs only edits a throwaway clone, only touches dependency manifests/lockfiles,
  and never pushes or opens a PR without an interactive confirmation (or an explicit `--yes`
  flag in CI). See §5.11. It still never force-pushes, never edits the user's working tree, and
  never acts on a repository the authenticated user has not chosen.
- It is not a full SAST engine. v1 ships lightweight pattern-based source checks and secret
  scanning; deep dataflow/taint analysis is out of scope.
- It does not store or transmit repository source to any third party except the configured
  LLM provider, and only does so under explicit opt-in (see §12 Security & Privacy).

---

## 2. Goals & Success Metrics

| Goal | Metric |
|---|---|
| Accurately identify known-vulnerable dependencies | ≥ 95% parity with `osv-scanner` on a fixture set of seeded vulnerable repos |
| Low false-noise reports | Findings are deduplicated, severity-ranked, and grouped; KEV/EPSS surfaced first |
| Fast interactive feedback | First findings stream to the TUI within ~5s of clone completion on a medium repo |
| Useful remediation | Every "Critical"/"High" finding includes a concrete fixed-version or patch recommendation where one exists upstream |
| Reproducible & scriptable | `--json` / `--sarif` output is deterministic given pinned DB snapshot; exit codes usable in CI |

---

## 3. Personas & User Stories

**Persona A — Maintainer (Mara):** owns an OSS repo, wants a periodic health check.
**Persona B — Security engineer (Sam):** vets third-party deps before adoption.
**Persona C — Contributor (Chris):** opening a PR, wants to know if their change touches known-risky code.

User stories:

1. *As Sam, I want to run `spiderwebs scan github.com/org/repo` and watch findings populate live in a terminal dashboard so I can triage interactively.*
2. *As Mara, I want a Markdown report I can paste into a GitHub Discussion that lists each vulnerability, its severity, exploitability, the related open issues, and the exact upgrade to apply.*
3. *As a CI pipeline, I want `spiderwebs scan . --json --fail-on high` to exit non-zero when a High+ unpatched vuln exists.*
4. *As Sam, I want the tool to tell me which of the repo's own open GitHub issues describe latent security problems, even when no CVE exists yet.*
5. *As Chris, I want to scan a single subdirectory or a specific lockfile.*
6. *As any user, I want to run fully offline against a cached vuln DB snapshot, with no LLM, getting deterministic findings.*

---

## 4. High-Level Flow

```
┌──────────────┐   ┌───────────────┐   ┌──────────────────┐   ┌─────────────────┐
│ 1. Ingest    │ → │ 2. Scan       │ → │ 3. Enrich        │ → │ 4. Correlate    │
│ clone/fetch  │   │ parse manifests│   │ CVSS/EPSS/KEV    │   │ GitHub issues   │
│ repo + meta  │   │ secrets/SAST  │   │ fix versions     │   │ ↔ findings/code │
└──────────────┘   └───────────────┘   └──────────────────┘   └─────────────────┘
                                                                        │
                          ┌─────────────────────────────────────────────┘
                          ▼
                 ┌──────────────────┐   ┌─────────────────┐   ┌──────────────────┐
                 │ 5. Agent reason  │ → │ 6. Prioritize   │ → │ 7. Report        │
                 │ (LLM + tools)    │   │ risk scoring    │   │ TUI/MD/JSON/SARIF│
                 └──────────────────┘   └─────────────────┘   └──────────────────┘
```

The deterministic core (steps 1–4, 6) runs without an LLM and produces a complete machine
report on its own. The **agent harness** (step 5) is an optional, additive layer that turns
raw findings into narrative, correlations, and a human-readable patch plan.

---

## 5. Functional Requirements

### 5.1 Ingestion (`ingest`)

- Accept repo references in multiple forms:
  - `https://github.com/org/repo`, `git@github.com:org/repo.git`, `org/repo` shorthand,
    a local path (`.` or `/path/to/repo`), or a `.git` URL on any host.
- Shallow-clone by default (`--depth 1`), with `--full` to fetch history (needed for the
  git-history secret scan). Use a temp workspace under the OS temp dir; clean up on exit
  unless `--keep`.
- Optionally pin to a `--ref <branch|tag|sha>`.
- Detect default branch via the host API; fall back to clone default.
- Support `--subdir <path>` and `--manifest <file>` to scope the scan.
- Respect a `.spiderwebsignore` (gitignore syntax) for excluding paths.

### 5.2 Dependency / SCA scanner (`scan:deps`) — the core

- Discover and parse all supported manifests/lockfiles in scope:

  | Ecosystem | Files parsed | PURL type |
  |---|---|---|
  | npm/pnpm/yarn | `package.json`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml` | `pkg:npm` |
  | Python | `requirements*.txt`, `poetry.lock`, `Pipfile.lock`, `pyproject.toml` | `pkg:pypi` |
  | Go | `go.mod`, `go.sum` | `pkg:golang` |
  | Rust | `Cargo.lock` | `pkg:cargo` |
  | Java | `pom.xml`, `*.gradle(.kts)` (best-effort), `gradle.lockfile` | `pkg:maven` |
  | Ruby | `Gemfile.lock` | `pkg:gem` |
  | PHP | `composer.lock` | `pkg:composer` |

- Resolve **both direct and transitive** dependencies (prefer lockfiles; fall back to
  manifest ranges flagged as "unpinned/approximate").
- Build a normalized internal dependency graph (nodes = package@version, edges = depends-on,
  carry `direct: boolean` and dependency path).
- Emit a **CycloneDX SBOM** as a byproduct (`--sbom out.json`).
- For each resolved component, query vulnerability databases (see §6) and attach findings.
- Each finding records: advisory IDs (CVE/GHSA/OSV), affected ranges, the **first fixed
  version(s)**, severity, CWE(s), source DB, and the dependency path that introduced it.

### 5.3 Secret scanner (`scan:secrets`)

- Pattern + entropy based detection across tree (and git history if `--full`): API keys,
  tokens, private keys, cloud credentials, high-entropy strings.
- Ship a curated rules set (regex + entropy thresholds) with allowlist support.
- Redact secret values in all output by default (show match location + rule, last 4 chars).

### 5.4 Lightweight source checks (`scan:code`)

- Pattern-based detection of common risky patterns (per language): use of `eval`,
  `child_process` with interpolation, deserialization sinks, disabled TLS verification,
  hardcoded weak crypto, SQL string concatenation, etc.
- These are **heuristics / signals**, clearly labeled lower-confidence than CVE findings.
  No taint analysis in v1.

### 5.5 License scanner (`scan:licenses`)

- Detect each dependency's declared license; flag copyleft/unknown/incompatible licenses
  against a configurable policy. (Compliance signal, not a vuln.)

### 5.6 GitHub issue correlation (`correlate:issues`)

- Fetch open issues (and optionally recently-closed) via the GitHub API with auth.
- Pre-filter issues by security signals (labels like `security`, `vulnerability`, `CVE`;
  keyword heuristics) to keep the agent's working set small.
- Correlate issues with findings/code in two directions:
  1. **Issue → finding:** an open issue that describes a known CVE already surfaced by SCA.
  2. **Issue → code:** an open issue describing a latent security problem with **no CVE**,
     mapped to the file(s)/symbol(s) it references.
- Output a correlation table: `issue # ↔ finding/file ↔ relationship ↔ confidence`.

### 5.7 Enrichment & risk scoring

- For each vulnerability finding, enrich with:
  - **CVSS** base score/vector (v3.1, and v4.0 when available).
  - **EPSS** (probability of exploitation in next 30 days) from FIRST.
  - **CISA KEV** membership (known exploited in the wild) — strong prioritization signal.
  - **Reachability hint (best-effort):** is the vulnerable package a direct dep and is the
    affected symbol imported anywhere in scope? (Coarse; clearly labeled as a hint.)
- Compute a composite **SpiderWebs Risk Score** combining severity, EPSS, KEV, direct-vs-
  transitive, and fix-availability. Document the formula in the report appendix.

### 5.8 Agent harness (`agent`) — optional reasoning layer

- An orchestration loop (LLM with tool-use) that consumes the structured findings and produces:
  - a plain-language executive summary,
  - per-finding "what/why/impact-if-unpatched" narrative,
  - the issue↔finding↔code correlations with rationale,
  - a **recommended patch plan** (ordered, grouped by upgrade, with version targets and
    a note on breaking-change risk),
  - a "questions for maintainers" section for ambiguous cases.
- The agent is **constrained to defensive analysis**: its tools are read-only against the
  workspace and the structured findings; it never writes/executes repo code and never
  produces exploit code. (See §9 for the tool contract.)
- Provider-agnostic via an `LLMProvider` interface; default implementation targets the
  Anthropic Messages API (`@anthropic-ai/sdk`) with tool use. Pluggable so a local model
  can be wired in. If no provider key is configured, SpiderWebs runs deterministic-only and
  emits the machine report.

### 5.9 Reporting (`report`)

- Formats: live **TUI**, **Markdown** (default file output), **JSON**, **SARIF 2.1.0**
  (for GitHub code scanning / CI ingestion), and **HTML** (self-contained).
- Report contents (Markdown/HTML):
  1. Header: repo, ref, scan time, tool version, DB snapshot date.
  2. Executive summary + counts by severity (Critical/High/Medium/Low/Info).
  3. Top risks (KEV + high EPSS first).
  4. Per-finding detail with fix recommendation and dependency path.
  5. GitHub issue correlations.
  6. Secret/code/license sections.
  7. **Patch plan** (the actionable centerpiece).
  8. Appendix: methodology, risk-score formula, data-source versions, disclaimer.
- All findings carry a stable `id` so reports can be diffed across runs (`--baseline`).

### 5.10 CLI behavior & exit codes

- Primary command: `spiderwebs scan <target> [options]`.
- Subcommands: `scan`, `fix`, `report`, `sbom`, `db update`, `config`, `version`.
- `--fail-on <none|low|medium|high|critical>` controls CI exit codes:
  `0` clean / below threshold, `1` findings at/above threshold, `2` tool error.
- `--quiet`, `--verbose`, `--no-color`, `--ci` (disables TUI, deterministic output).

### 5.11 Guided remediation — auto-fix & pull-request generation (`fix`)

An **opt-in** workflow that turns a finding into an upstream pull request. It is deterministic
(not the LLM agent) and gated behind explicit consent. Triggered from the TUI (`F` on a selected
finding / patch-plan step) or the CLI (`spiderwebs fix`).

**Pipeline (per fixable finding or patch-plan step):**

1. **Working clone.** Materialize a *throwaway* clone under `./.spiderwebs-workspace/<owner>-<repo>/`
   (inside the current directory, git-ignored, created on demand, removed unless `--keep`). The
   user's own working tree is never touched.
2. **Plan the fix.** For a **direct** dependency vulnerability, compute the minimal safe upgrade —
   the lowest version `≥` the finding's first-fixed-version that satisfies the manifest's intent —
   and the exact manifest edit. (v1 scope: **direct dependencies only**; transitive overrides/
   resolutions are a follow-up.)
3. **Apply the edit + regenerate the lockfile.** Edit the manifest (`package.json`, …), then
   regenerate the lockfile by invoking the matching package manager **with lifecycle/install
   scripts disabled** (`npm/pnpm/yarn ... --ignore-scripts`) inside the workspace. This is the one
   sanctioned tool invocation; it resolves dependency versions but, with scripts disabled, does
   **not** execute arbitrary repo code (see §12).
4. **Commit on a branch.** Create `spiderwebs/fix-<package>-<version>`; commit with a message that
   references the advisory id(s) and finding id(s).
5. **Route the PR.** If the authenticated user has push access to the target repo, push the branch
   directly; otherwise **fork** the repo to the user's account, push there, and open a
   **cross-fork** PR. Fork/permission detection and PR creation go through the **GitHub CLI
   (`gh`)** — SpiderWebs reuses the user's existing `gh auth` session (no SpiderWebs-hosted service,
   no token handling of our own). If `gh` is absent or unauthenticated, SpiderWebs stops with a
   clear "run `gh auth login`" message and still writes the patch as a local diff.
6. **Open the PR.** Title/body generated by SpiderWebs, clearly self-identified, listing the
   advisories resolved, the version delta, the dependency path, and a breaking-change caution.
   One PR per package upgrade.

**Consent & safety (non-negotiable):**

- **Nothing leaves the machine without confirmation.** The TUI shows a diff + target and requires
  an explicit keypress; the CLI requires interactive confirmation or `--yes`. `--dry-run` performs
  every step *except* push/PR and prints the diff and the PR it *would* open.
- Never force-push; never reuse/overwrite an unrelated branch; never touch the user's working tree.
- Only acts on a repository the authenticated user explicitly selected.
- Rate-aware and idempotent: re-running detects an existing SpiderWebs branch/PR instead of
  duplicating it.

---

## 6. Data Sources (vulnerability & enrichment)

All are public and free unless noted. Network access is configurable; an offline cache is
maintained for reproducibility.

| Source | Use | Endpoint / notes |
|---|---|---|
| **OSV.dev** | Primary vuln lookup across all ecosystems (also mirrors GHSA) | `POST https://api.osv.dev/v1/querybatch` (batched by package+version), `/v1/query`. No auth, generous limits. |
| **GitHub Advisory DB (GHSA)** | Secondary/confirmation, richer fix metadata | GraphQL `securityVulnerabilities`; needs a token. Largely covered via OSV too. |
| **NVD 2.0** | CVSS vectors, CWE, descriptions | `https://services.nvd.nist.gov/rest/json/cves/2.0`. Rate-limited (recommend an `NVD_API_KEY`; 5 req/30s without, 50 with). |
| **EPSS (FIRST)** | Exploitation probability | `https://api.first.org/data/v1/epss?cve=CVE-...` (batchable). |
| **CISA KEV** | Known-exploited flag | `https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json` (single JSON feed; cache daily). |
| **GitHub REST/GraphQL** | Repo metadata, default branch, issues | Octokit; `GITHUB_TOKEN` for rate limits + private repos. |
| **GitHub CLI (`gh`)** | Auth, fork, push, and PR creation for the `fix` workflow (§5.11) | Delegates to the user's existing `gh auth` session; SpiderWebs stores/handles no GitHub credentials of its own. |

**Caching / `db update`:** snapshot KEV + EPSS + per-package OSV responses to a local
on-disk cache (e.g. under `~/.spiderwebs/cache`) keyed by package@version and source version.
`spiderwebs db update` refreshes snapshots; `--offline` forbids network and uses cache only.
This makes scans reproducible and CI-friendly.

> **Important correctness note for the implementer:** prefer **OSV's batched query** as the
> backbone (it's ecosystem-aware, handles version-range matching, and includes GHSA data),
> then *enrich* matched CVEs with NVD (CVSS) + EPSS + KEV. Do not naively string-match CVE
> IDs against package names — always resolve via PURL/ecosystem + version-range matching that
> the source provides.

---

## 7. Technical Architecture

### 7.1 Layered design

```
apps/
  cli/            # commander entrypoint, arg parsing, exit codes
  tui/            # Ink (React) dashboard, screens, live streaming
packages/
  core/           # orchestrator: pipeline stages, event bus, run lifecycle
  ingest/         # clone/fetch via isomorphic-git or simple-git
  parsers/        # one module per ecosystem -> normalized DependencyGraph
  scanners/       # deps, secrets, code, licenses (pluggable Scanner interface)
  vulndb/         # OSV/NVD/EPSS/KEV clients + cache + version-range matching
  github/         # Octokit wrapper: repo meta, issues, advisories
  correlate/      # issue<->finding<->code correlation
  enrich/         # CVSS/EPSS/KEV merge + risk scoring
  agent/          # LLMProvider interface, tool contract, orchestration loop
  report/         # renderers: markdown, json, sarif, html, tui-model
  schema/         # zod schemas + shared types (Finding, Component, Report...)
  config/         # cosmiconfig loading, defaults, secrets from env
```

### 7.2 Pipeline & events

- The `core` orchestrator runs stages as an async pipeline and emits **events**
  (`stage:start`, `finding:new`, `progress`, `stage:done`, `error`) on a typed event bus.
- The TUI subscribes to events to stream findings live; the CLI/`--json` consumers subscribe
  to the same bus and serialize at the end. This single source of truth keeps TUI and headless
  output consistent.
- Concurrency: bounded parallelism (e.g. `p-limit`) for DB lookups; respect per-source rate
  limits with a token-bucket limiter and exponential backoff + retry.

### 7.3 Recommended tech stack

| Concern | Choice | Rationale |
|---|---|---|
| Language/runtime | TypeScript, Node ≥ 20, **ESM**, strict mode | Modern, typed, top-level await |
| CLI framework | **commander** (or `clipanion`) | Mature, simple subcommands |
| TUI | **Ink** (+ `ink-table`, `ink-spinner`, `ink-text-input`) | React model for terminals; great DX, testable |
| Git | **isomorphic-git** (no native dep) or **simple-git** (shells to git) | isomorphic-git = portable single binary; simple-git = faster on big repos. Make it an adapter. |
| GitHub API | **@octokit/rest** + **@octokit/graphql** | Official, typed, throttling plugin |
| HTTP | `undici` / native `fetch` | Built-in, fast |
| Schema/validation | **zod** | Runtime validation of API responses + config |
| Rate limit/retry | `p-limit`, `p-retry`, custom token bucket | Respect NVD/GitHub limits |
| Lockfile parsing | `@yarnpkg/lockfile`, `@pnpm/lockfile-file`, `yaml`, `@iarna/toml`, fast-xml-parser | Per-ecosystem parsers |
| SBOM | `@cyclonedx/cyclonedx-library` | Standard SBOM emit |
| LLM | **@anthropic-ai/sdk** behind an `LLMProvider` interface | Tool-use agent; provider-swappable |
| Config | **cosmiconfig** | `.spiderwebsrc`, `spiderwebs.config.ts`, env |
| Logging | `pino` (json) + pretty for dev | Structured logs, `--verbose` |
| Testing | **vitest** + `nock`/`msw` for HTTP, fixture repos | Fast, mockable |
| Build/dist | `tsup` (lib) + `pkg`/`bun build`/SEA for binary | Single-file binary distribution |
| Lint/format | eslint + prettier (or biome) | Consistency |

> Pin to the latest stable versions at build time; the table reflects intended choices, not
> exact semver. Prefer libraries with active maintenance and TypeScript types.

---

## 8. TUI / UX Design

A keyboard-driven Ink app. Three primary views, switchable via tabs / hotkeys.

**View 1 — Scan progress (default while running):**
- Header (repo, ref, elapsed).
- Stage list with spinners/checks (Ingest → Deps → Secrets → Code → Enrich → Issues → Agent → Report).
- Live counters (Critical/High/Medium/Low) updating as `finding:new` events arrive.
- Streaming log pane (toggle with `l`).

**View 2 — Findings explorer (after/while scanning):**
- Left: severity-grouped, scrollable list of findings (KEV ★ and high-EPSS flagged).
- Right: detail pane for the selected finding — advisory IDs, CVSS vector, EPSS, dependency
  path, fixed version, related issues, recommended action.
- Filters: `f` filter by severity/ecosystem/KEV; `/` fuzzy search; `o` open advisory URL.

**View 3 — Patch plan:**
- The ordered remediation steps grouped by upgrade, with target versions, affected findings
  resolved per step, and a breaking-change risk badge.
- `e` export report (md/json/sarif/html), `c` copy plan to clipboard.

**Global keys:** `tab` switch view, `q` quit, `?` help overlay, arrows/`j`/`k` navigate,
`enter` select. Respect `NO_COLOR` and degrade gracefully on dumb terminals (auto `--ci`).

---

## 9. Agent Harness — Tool Contract & Guardrails

The agent is an LLM loop whose job is **interpretation and remediation planning**, not
detection. Detection already happened deterministically. Tools are **read-only**:

| Tool | Purpose | Constraints |
|---|---|---|
| `get_findings(filter)` | Read structured findings from the run | Read-only |
| `get_dependency_path(component)` | How a vuln dep was introduced | Read-only |
| `read_repo_file(path, range?)` | Read a file in the workspace | Sandboxed to workspace, size-capped, no writes/exec |
| `search_code(query)` | ripgrep-style search in scope | Read-only |
| `get_issue(number)` / `list_security_issues()` | Read GitHub issues | Read-only |
| `get_advisory(id)` | Fetch enriched advisory detail | Read-only, from cache/DBs |
| `get_fix_versions(component)` | Upstream fixed versions | Read-only |

Guardrails (system-prompt + code enforced):
- The agent **must not** produce exploit code, attack steps, or payloads. Its outputs are
  defensive: explanation, prioritization, and upgrade/patch recommendations.
- No tool can write to disk, execute code, or make outbound calls beyond the whitelisted
  read APIs.
- Token/cost budget per run (`--agent-budget`), with summarization of large finding sets
  before reasoning. Deterministic fallback if the budget is exceeded or no provider configured.
- Every agent claim in the report should reference the structured finding/issue it derives
  from, so output is auditable against the deterministic core.

---

## 10. Configuration

Resolution order: CLI flags > env vars > project config (`spiderwebs.config.ts` / `.spiderwebsrc`) > defaults.

```ts
// spiderwebs.config.ts (example)
export default {
  sources: { osv: true, nvd: true, epss: true, kev: true, github: true },
  failOn: 'high',
  agent: { enabled: true, provider: 'anthropic', budgetUsd: 0.50 },
  ignore: ['**/test/fixtures/**'],
  licensePolicy: { deny: ['AGPL-3.0'], warn: ['GPL-3.0'] },
  report: { formats: ['markdown', 'sarif'], outDir: './spiderwebs-out' },
}
```

Secrets come **only** from env: `GITHUB_TOKEN`, `NVD_API_KEY`, `ANTHROPIC_API_KEY`.
Never read tokens from config files; never log them.

---

## 11. Performance & Reliability

- Stream results; don't block the whole scan on one slow source.
- Batch OSV queries (hundreds of components per call); dedupe identical package@version lookups.
- Cache aggressively; honor ETags/Last-Modified where the source supports them.
- Backoff + retry with jitter on 429/5xx; degrade gracefully if a source is down (mark that
  source "unavailable" in the report rather than failing the whole run).
- Bounded memory: large repos parsed via streaming where feasible; cap file sizes for code scan.
- Target: medium repo (≈ 1k deps) full scan in well under a minute warm-cache, deterministic core.

---

## 12. Security & Privacy (of the tool itself)

- **Treat scanned repos as untrusted input.** Never execute repo code, install scripts, or
  build steps. Parse manifests as data only. Sandbox file reads to the workspace; guard against
  path traversal and zip-slip-style attacks.
- **Source minimization to LLM:** when the agent is enabled, only the specific file ranges the
  agent requests (capped) are sent to the provider, and only with explicit opt-in. Provide a
  `--no-source-to-llm` mode that lets the agent reason over findings/issues metadata only.
- Redact secrets in all outputs by default.
- Never transmit tokens to any non-official endpoint; scope GitHub token to least privilege.
- Clean up temp clones on exit. Document exactly what leaves the machine and to where.
- **Remediation workflow (§5.11) safety:** the lockfile regeneration step is the *only* sanctioned
  tool invocation, and it always runs with lifecycle/install scripts disabled (`--ignore-scripts`)
  inside the throwaway clone — never in the user's working tree. SpiderWebs owns no GitHub
  credentials (it delegates to `gh`), never force-pushes, opens at most one PR per package upgrade,
  and performs no network-mutating action (push / fork / PR) without explicit consent
  (`--yes`) or an interactive confirmation. `--dry-run` exercises everything up to, but not
  including, that consent boundary.

---

## 13. Testing Strategy

- **Unit:** each parser against real-world lockfile fixtures (incl. edge cases: workspaces,
  monorepos, aliased deps, git deps).
- **Vulndb:** mock OSV/NVD/EPSS/KEV with recorded fixtures; assert version-range matching,
  fixed-version extraction, and KEV/EPSS merge.
- **Integration:** seeded "vulnerable repo" fixtures with known CVEs; assert exact findings.
- **Differential:** compare dependency-vuln output against `osv-scanner` on the fixture set.
- **Snapshot:** Markdown/SARIF report snapshots for deterministic core (agent disabled).
- **TUI:** `ink-testing-library` render assertions for each view + key handling.
- **Agent:** mock `LLMProvider` returning canned tool-call transcripts; assert the loop,
  budget enforcement, and guardrail refusals.

---

## 14. Phased Roadmap (build order)

**Milestone 0 — Skeleton:** monorepo scaffolding, `schema` (zod types), config loader,
`commander` CLI shell, logging, `version`. Deterministic-only, no network.

**Milestone 1 — Deterministic SCA core (the MVP):**
ingest (clone) → npm/pnpm/yarn parsers → dependency graph → **OSV** lookup with version-range
matching → JSON report → `--fail-on`. Ships value on its own.

**Milestone 2 — Enrichment + more ecosystems:** NVD/EPSS/KEV merge + risk score; Python, Go,
Rust parsers; Markdown + SARIF reports; SBOM emit; on-disk cache + `db update` + `--offline`.

**Milestone 3 — TUI:** Ink dashboard (3 views), live event streaming, filters/search/export.

**Milestone 4 — GitHub issue correlation:** Octokit integration, security-issue prefiltering,
issue↔finding↔code correlation table.

**Milestone 5 — Agent harness:** `LLMProvider` interface + Anthropic implementation, read-only
tool contract + guardrails, executive summary + narrative + **patch plan**, budget controls.

**Milestone 6 — Polish:** secret + lightweight code + license scanners, HTML report, `--baseline`
diffing, binary packaging, docs.

**Milestone 7 — Guided remediation (auto-fix → PR) (§5.11):** in-repo throwaway workspace; direct-
dependency fix planner; manifest edit + lockfile regeneration via the package manager with
`--ignore-scripts`; branch/commit; `gh`-delegated auth, fork/permission detection, push, and PR
creation; TUI `F` action and `spiderwebs fix` CLI with `--dry-run`/`--yes`; consent + idempotency
guardrails.

**v2 stretch:** transitive auto-fix via overrides/resolutions, reachability/dataflow improvements,
plugin SDK for custom scanners, scheduled/watch mode.

---

## 15. Open Questions / Risks

- **Gradle parsing** is hard without resolving the build; v1 should be best-effort and clearly
  labeled approximate.
- **NVD rate limits** can throttle large scans — make OSV the backbone and NVD enrichment best-effort.
- **Agent cost/nondeterminism** — keep the deterministic core authoritative; the agent is additive.
- **Issue→code correlation precision** — start conservative, report confidence, avoid overclaiming.
- **Private repos** require a token with appropriate scope; document clearly.
- **Auto-fix correctness (§5.11):** a version bump can introduce breaking changes; PRs must caution
  clearly and never auto-merge. Direct-only scope avoids the hardest cases (transitive pins) for now.
- **Lockfile regeneration vs. untrusted code:** running the package manager — even with
  `--ignore-scripts` — on an untrusted repo is a residual risk; keep it sandboxed to the throwaway
  clone, pin the package-manager invocation, and never run arbitrary postinstall/lifecycle scripts.
- **PR-spam / consent:** opening PRs on repos the user doesn't own is sensitive; require explicit
  consent per PR, self-identify in the PR body, stay idempotent, and never act unprompted.
- **`gh` dependency:** the remediation workflow requires an installed, authenticated GitHub CLI;
  degrade to writing a local patch diff with clear guidance when it is missing.

---

## 16. Acceptance Criteria (v1 "done")

- `spiderwebs scan github.com/<org>/<repo>` clones, scans npm/Python/Go/Rust/PHP/Ruby/Java
  (best-effort) deps, and produces Critical/High/Medium/Low findings with fixed-version
  recommendations and dependency paths.
- Findings are enriched with CVSS, EPSS, and KEV; sorted by a documented risk score.
- Open security-relevant GitHub issues are correlated to findings/code in the report.
- The agent (when enabled) emits an executive summary and an ordered patch plan grounded in
  the deterministic findings, and refuses to produce any offensive content.
- Output available as live TUI, Markdown, JSON, and SARIF; `--fail-on` drives CI exit codes;
  `--offline` produces deterministic results from cache.
- Guided remediation (§5.11): from the TUI (`F`) or `spiderwebs fix`, SpiderWebs patches a direct-
  dependency finding in a throwaway clone (manifest edit + lockfile regenerated with
  `--ignore-scripts`), and — after explicit consent — pushes a branch (forking when needed) and
  opens a self-identified PR via `gh`. `--dry-run` shows the diff and intended PR without pushing.
- Test suite (unit + integration + snapshot) green; differential parity vs `osv-scanner` ≥ 95%
  on fixtures.

