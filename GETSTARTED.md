❯ Please tell me how I can manually test what we created so far

⏺ Let me quickly confirm the built CLI is in place so I give you accurate commands, then I'll lay out the full manual test guide.

⏺ Bash(cd /Users/coder/repos/offsideai/githubrepos_workspace_active_1/SpiderWebs/SpiderWebs-App
      test -f apps/cli/dist/index.js && echo "CLI built: yes" || echo "CLI bu…)
  ⎿  CLI built: yes
     deps installed: yes

⏺ Everything's in place. Here's how to manually exercise what we've built in Milestone 0. All commands run from the app folder:

  cd SpiderWebs-App

  (If you ever start fresh: pnpm install && pnpm build first.)

  1. Run the automated test suite

  pnpm test            # 79 tests across schema, config, core, cli
  pnpm check           # full gate: build + lint + format + test

  This is the most complete picture — it covers the schema validation, config precedence, the secret-rejection guard, the event bus, exit-code logic, and the CLI end-to-end.

  2. Drive the CLI by hand

  For convenience, make a shell alias so you can type spiderwebs:

  alias spiderwebs="node $(pwd)/apps/cli/dist/index.js"

  Things that work today

  spiderwebs --help          # lists scan, report, sbom, db, config, version
  spiderwebs version         # → "spiderwebs 0.1.0"
  spiderwebs -V              # → "0.1.0"
  spiderwebs config          # prints resolved config + which secrets are set
  spiderwebs config --json   # same, machine-readable

  Exit codes (check with echo $? after each)

  spiderwebs version;            echo $?   # 0  — success
  spiderwebs scan org/repo;      echo $?   # 2  — stub, "arrives in Milestone 1"
  spiderwebs exploit;            echo $?   # 2  — unknown command
  spiderwebs scan x --fail-on extreme; echo $?  # 2 — invalid value, lists valid choices

  The stubs (scan, report, sbom, db update) intentionally fail with exit 2 and a message naming the milestone they arrive in — that's expected, not a bug.

  3. See the config system in action

  Secrets come only from env vars, never printed:

  GITHUB_TOKEN=ghp_demo123 spiderwebs config
  # Look at the bottom: GITHUB_TOKEN shows "set", but the value ghp_demo123 is never echoed.

  Config precedence (CLI > env > file > defaults):

  SPIDERWEBS_FAIL_ON=high spiderwebs config --json | grep failOn
  # → "failOn": "high"   (env override beats the default of "none")

  The security guard — a config file containing a token is rejected:

  mkdir -p /tmp/sw-secret-test
  echo '{ "github": { "token": "ghp_secret" } }' > /tmp/sw-secret-test/.spiderwebsrc.json
  cd /tmp/sw-secret-test && spiderwebs config; echo $?
  # → exit 2, error tells you to use GITHUB_TOKEN env var instead,
  #   and the token value is NOT echoed in the error.
  cd -

  A valid project config is picked up:

  mkdir -p /tmp/sw-config-test
  echo '{ "failOn": "medium", "report": { "formats": ["json","sarif"] } }' > /tmp/sw-config-test/.spiderwebsrc.json
  cd /tmp/sw-config-test && spiderwebs config --json | grep -A3 failOn
  cd -

  What you can't test yet

  There's no real scanning, reporting, or TUI — those are Milestones 1–6. Right now you're verifying the skeleton: the command surface, config resolution, secret handling, and exit-code plumbing. The
  richest validation is pnpm test; the CLI commands above let you see the same behavior interactively.

  One note: the spiderwebs alias only lasts for your current terminal session. To make it permanent, add that alias line to your ~/.zshrc, or run node apps/cli/dist/index.js … directly.
