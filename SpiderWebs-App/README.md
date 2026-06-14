# SpiderWebs

An agentic, CLI-first + TUI **defensive** security auditor for remote Git repositories.
It detects known-vulnerable dependencies (SCA via OSV/NVD/EPSS/KEV), correlates a repo's
own open GitHub issues with findings, and produces a prioritized, patch-aware remediation
report. It never generates exploit code and never executes scanned repository code.

See [PRD.md](../PRD.md) for the full product requirements. **Status: Milestone 0 (skeleton).**

## Layout

| Package           | Purpose                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| `apps/cli`        | `spiderwebs` commander CLI: `scan`, `report`, `sbom`, `db update`, `config`, `version`                 |
| `packages/schema` | zod schemas/types: `Component`, `Advisory`, `Finding`, `Correlation`, `Report`, `RunEvent`, stable ids |
| `packages/config` | cosmiconfig loader, defaults, PRD §10 precedence, env-only secrets guard                               |
| `packages/core`   | typed event bus, pino logging (redacted), exit-code policy                                             |

Further packages (`ingest`, `parsers`, `vulndb`, `report`, `github`, `correlate`, `enrich`,
`agent`, `apps/tui`) arrive in later milestones (PRD §14).

## Development

Requires Node ≥ 20 and pnpm 11.

```sh
pnpm install
pnpm build        # tsc for packages, tsup bundle for the CLI
pnpm test         # vitest (runs against TS sources, no build needed)
pnpm lint
pnpm format
pnpm typecheck
pnpm check        # all of the above
```

Run the CLI from source:

```sh
node apps/cli/dist/index.js --help
```

## Configuration

Resolution order: CLI flags > `SPIDERWEBS_*` env vars > project config > defaults.
Project config lives in `.spiderwebsrc(.json|.yaml|.js)`, `spiderwebs.config.(js|cjs|mjs)`,
or a `"spiderwebs"` key in `package.json` (`.ts` config support is planned).

Secrets come **only** from environment variables — `GITHUB_TOKEN`, `NVD_API_KEY`,
`ANTHROPIC_API_KEY`. Config files containing token-like keys are rejected outright,
and log output redacts token-shaped fields.

## Exit codes

| Code | Meaning                                              |
| ---- | ---------------------------------------------------- |
| 0    | Clean, or no findings at/above the `--fail-on` level |
| 1    | Findings at or above the `--fail-on` threshold       |
| 2    | Tool error (bad usage, network/config failure)       |
