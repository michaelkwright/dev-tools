# dev-tools

**New to this? [Start here.](GETTING-STARTED.md)**

Portable Claude Code skills and dev tooling, offered as-is. No support is promised. Issues are welcome; pull requests are not being accepted for now (see [CONTRIBUTING](CONTRIBUTING.md)). Report security problems privately (see [SECURITY](SECURITY.md)).

## Before you use this

- **A skill is a set of instructions an AI agent will follow with your permissions.** Read a skill's `SKILL.md` and the files it points to before you install it, as you would read a script before running it.
- **Pin to a commit rather than tracking `main`.** `install.sh` links the skills to this checkout, so whatever is checked out is what your agent follows. Check out a commit you have read, and review the diff before you move to a newer one.
- **`posture-audit.sql` is read-only; the templates are not.** The audit is a single `SELECT`. The `supabase-hardening` templates run `REVOKE` and `GRANT` statements against your database: they are starting points to read and adapt to your schema, not to paste and run.
- **There is no warranty.** Everything here is provided as-is under the [MIT license](LICENSE).

## Skills

| Skill | What it does |
| --- | --- |
| [`ci-minutes-audit`](skills/ci-minutes-audit/SKILL.md) | Read-only analyzer of a repo's GitHub Actions history: where the billed minutes went, and which levers would cut them. Includes a default CI shape, verified billing facts, lessons, and a worked case study. |
| [`doc-system`](skills/doc-system/SKILL.md) | A spec, windowed changelog, forward-only roadmap, decision records and handoffs, held to shape by a vitest contract test. Seeds a new repo or adopts an existing one's docs without rewriting them. |
| [`llm-call-hygiene`](skills/llm-call-hygiene/SKILL.md) | Calling a model API without the silent failures: reading the trailing text instead of a fixed index, checking the stop reason before parsing, per-model request bodies, model swaps, per-call logging and capped paid runs, and server-built prompts. Includes copyable response helpers for the Anthropic Messages API, a fixed-index-read guard on the ratchet core, and a capped repeated-draw runner with a dry run, all proven by a harness that makes no API call. |
| [`observability-traps`](skills/observability-traps/SKILL.md) | Signals that look like evidence and are not: counters, timestamps, empty results, scheduler ledgers, product-usage noise and platform metrics. Includes a heartbeat table and a read-only two-sided watchdog query, proven by a PGlite break-probe harness. |
| [`project-bootstrap`](skills/project-bootstrap/SKILL.md) | Sets up the planning → Claude Code workflow in a new or existing repo: `CLAUDE.md`, the doc system, committed permission rules and the Claude.ai planning instructions. |
| [`ratchet-tests`](skills/ratchet-tests/SKILL.md) | Bidirectional snapshot ratchets: enumerate every site of a bug class from source, hold the violations to a worklist CI keeps honest in both directions, and fail in the diff that introduces a new one. Includes a generic ratchet core, a ready-to-adopt fixture-date ratchet, and recipes for unchecked results and the vitest environment split. |
| [`supabase-hardening`](skills/supabase-hardening/SKILL.md) | Database-side security for a Supabase project: born-open default grants, gates that look closed and are not, Edge Function and Storage auth, and how to prove each. Includes migration templates and a read-only posture audit, both proven by a PGlite break-probe harness. |
| [`vitest-suite-speed`](skills/vitest-suite-speed/SKILL.md) | Measure-first method for a slow vitest suite, and the node/jsdom environment split to set up in a new project. |

## Install

```bash
git clone https://github.com/michaelkwright/dev-tools.git
cd dev-tools
./install.sh
```

To pin, run `git checkout <commit>` here before installing (see [Before you use this](#before-you-use-this)). Git then reports a "detached HEAD": that is expected and fine. `project-bootstrap` checks only that the checkout is clean and that the pinned commit is on this repo's published default branch.

`install.sh` links each folder under `skills/` into `~/.claude/skills/` as an absolute symlink, so whatever this checkout holds is live everywhere: a `git pull` or `git checkout` here changes every installed skill at once. It is safe to re-run. A symlink that points elsewhere is repointed (and the old target is printed). A real file or directory already at that name is never touched: the script refuses it and exits non-zero. Set `CLAUDE_SKILLS_DIR` to install somewhere other than `~/.claude/skills`. A folder without a `SKILL.md` is skipped with a notice.

## Starting a project

Install the skills, then open Claude Code in the new (or existing) repo and ask it to bootstrap the project. It reads the repo first, asks only what it can't detect, and never overwrites an existing file without showing you the merge. You get:

- a `CLAUDE.md` with the session workflow, gates and failure-pattern conventions;
- the doc system (spec, changelog, roadmap, decisions, handoffs, audits) and its contract test, run green;
- a committed `.claude/settings.json` denying force pushes and remote branch deletion, plus `supabase db push` for Supabase projects, and the writable connector's `apply_migration` when you apply schema changes by hand;
- the Claude.ai planning instructions, written to a gitignored local file and offered on your clipboard, for you to paste into your Claude.ai Project's custom instructions.

At the end it offers to commit the result and, when the repo has no remote yet, to create the GitHub repo; it pushes only on your yes.

The two source templates are in [`skills/project-bootstrap/templates/`](skills/project-bootstrap/templates/).

## Rule: nothing project-specific goes in here

Every example is anonymized ("a solo-built React + Supabase app"). No project names, repo names, commit SHAs, workflow run IDs, keys or account IDs. Anything that names a specific repo, job or ID comes in through a command-line argument or an environment variable, never from a file in this repo. A secret scan runs on every push.

## Maintainer scrub gate

Pushes run `scripts/scrub.sh`, which scans exactly what is published (the index, the history of every branch, tag and remote ref, commit messages, identities and paths) with gitleaks and against a private denylist and vocabulary kept outside the repo (`~/.config/dev-tools/scrub`, or `SCRUB_CONFIG_DIR`). Untracked and ignored files are never read. How each check matches, including the term lists' word boundaries and variants, is stated once in the header of `scripts/scrub.sh`. It fails closed: a missing config or tool blocks the push. The hook in `.githooks/pre-push` only activates in clones that run `git config core.hooksPath .githooks`, so if you cloned this repo you can ignore all of it.

## License

[MIT](LICENSE).
