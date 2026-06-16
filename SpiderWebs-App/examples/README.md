# Example fixture repositories

Small, self-contained projects used by the manual test cases in
[`../../TESTING.md`](../../TESTING.md). They contain **only manifests/lockfiles** —
no real `node_modules`, no source, nothing executable. SpiderWebs parses the
lockfiles as data; it never installs or runs these.

| Directory          | Lockfile           | Notable pinned deps                              |
| ------------------ | ------------------ | ------------------------------------------------ |
| `vulnerable-npm`   | `package-lock.json`| `lodash@4.17.20`, `minimist@1.2.5` (known CVEs)  |
| `vulnerable-pnpm`  | `pnpm-lock.yaml`   | `lodash@4.17.20`, `minimist@1.2.5`               |
| `vulnerable-yarn`  | `yarn.lock`        | `lodash@4.17.20`, `minimist@1.2.5`               |
| `clean-npm`        | `package-lock.json`| only current, non-vulnerable versions            |
| `monorepo`         | two `package-lock.json` in `packages/*` | for `--subdir` scoping     |

The "vulnerable" pins are old releases with well-known advisories, so an online
scan against OSV.dev should always return findings for them.
