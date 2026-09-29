---
name: ci-minutes-audit
description: Use when auditing where a repo's GitHub Actions minutes go or how to cut CI minute spend (a read-only analyzer bills every run and job per GitHub's rules and estimates each lever), or when setting up or reviewing CI for a new project with minute economy in mind.
---

# CI minutes audit

`ci-minutes.mjs` (this folder) reads a repo's Actions history through the `gh` CLI and reports where the billed minutes went. It is read-only and repo-agnostic.

## Run it

Needs Node 22+ and an authenticated `gh` that can read the repo's Actions data.

```bash
# current repo, current UTC month to date
node ~/.claude/skills/ci-minutes-audit/ci-minutes.mjs

# a closed month, with the docs-only job named, written to files
node ~/.claude/skills/ci-minutes-audit/ci-minutes.mjs --since 2026-08-01 --until 2026-08-31 \
  --docs-only-job "Test (docs-only)" --out /tmp/aug.md

# any other repo
node ~/.claude/skills/ci-minutes-audit/ci-minutes.mjs --repo owner/name --since 2026-09-01
```

Flags: `--repo`, `--since`, `--until` (UTC, inclusive), `--docs-only-job NAME` (repeatable; names a job that only runs on a docs-only path), `--out PATH.md` (also writes a sibling `PATH.json` of raw aggregates plus every run and job), `--cache-dir`, `--step-regex CATEGORY=REGEX` (override `setup` / `install` / `build` / `test`), `--refresh` (ignore the response cache). Responses are cached per repo in the OS temp dir, so re-runs are cheap and a rate-limit stop resumes where it left off. A month of a busy repo costs a few hundred API calls; the report states the count.

## What each section means

| Section | Meaning |
| --- | --- |
| Summary | Runs, computed billed minutes, raw job minutes, blocked runs. |
| By run class | `full`, `docs-only` (a `--docs-only-job` job ran), `blocked` (never started: billing/spending block, counted as zero spend, not as spend), `no-billable`, `no-jobs`. |
| By event / job / conclusion / day | Billed minutes and share along each axis. Skipped jobs cost zero and are listed separately. |
| By step category | Raw seconds inside steps of jobs that ran, bucketed by the step-name regexes. Shares of billed minutes are that raw share applied to the billed total (an estimate). |
| Blocked runs | Count, first blocked run, last run that billed, the check-run annotation text that proves the cause, and an imputed cost had they run. |
| Timing-endpoint cross-check | Compares GitHub's per-run `/timing` figures with the script's own. The endpoint is documented as closing down; when it returns zeros the report says so and relies on the computed figure. |
| Account-level usage | The authoritative billing-usage total when the token can read it (needs the `user` scope for a personal account); otherwise the refusal is recorded. |
| Rounding overhead | Billed minutes minus raw minutes; GitHub rounds each job up to a whole minute. |
| Cadence and superseded | Runs per day, and runs whose next run on the same workflow, branch and event started before they finished. |
| What-if estimates | Four labelled estimates with the arithmetic shown. They overlap, so do not add them. |

Billing rule used: per job, `ceil(seconds / 60)` minutes times the runner multiplier (Linux 1, Windows 2, macOS 10); self-hosted runners and public repositories are free. Where GitHub's docs and a live response disagree, follow the live response and note it.

## Finding to lever

| Finding | Lever |
| --- | --- |
| Large docs-only share of runs or minutes | Skip docs-only runs entirely (or keep a slim job) |
| Superseded runs that ran to completion | `concurrency` with `cancel-in-progress: true` |
| Large install share and no cache configured | Dependency caching |
| Rounding overhead high with many short jobs | Merge short jobs into one |
| Large full-run volume, CI is reporting-only, and a local gate exists | Scheduled (nightly) CI instead of per-push |
| CI is the merge gate | Scheduled CI is not a fit; use the other levers |
| A matrix leg carrying a large share of billed minutes | Run the extra legs on a schedule only |
| A tiny decision or setup job runs on every run | Each job bills a whole minute however short, so a 7-second job costs a full minute per run; move the decision to workflow-level path filters (`paths-ignore`) or into a step of an existing job |
| Jobs with no explicit `timeout-minutes` | They inherit the platform default (360 minutes), so a hung job can bill up to six hours; set `timeout-minutes` on every job as a spend cap sized from observed durations plus headroom |

## Default CI shape

For a new project, or when reviewing an existing one:

- Per push: typecheck and build as ONE job. Each job bills a whole minute at minimum, so a second small job is a second minute.
- Markdown-only pushes run nothing: workflow-level `paths-ignore: ['**.md']` on `push` and `pull_request`. First grep the build for anything that reads Markdown; if something does, that path must stay out of the ignore list.
- The full test suite runs on a daily schedule (off the top of the hour) and skips a commit that already passed, failing open on any doubt so a red run is never followed by a skip.
- The extra timezone (or OS/version) leg runs once a week inside the scheduled run (a second cron line), not as a separate run and not per push.
- Explicit `timeout-minutes` on every job, sized from observed durations plus headroom.
- Minimum token permissions: workflow-level `permissions: contents: read`, adding only what a job needs (listing runs needs `actions: read`; naming any permission zeroes the rest).

**Exception:** if CI is the merge gate (no mandatory local full-suite gate), run the full suite per push instead; scheduled-only CI would let a red commit merge.

Reporting-only CI also needs a pull channel (a session-start check of the latest scheduled result), because nobody reads the Actions tab.

## Reference files

Open these from this folder when needed:

- `reference/github-billing-facts.md`: one-line billing, trigger and API facts with verification date and source URL. Open before quoting any quota, rate or endpoint behavior; re-verify live first, since GitHub changes them.
- `reference/lessons.md`: short lessons on what misled the first audit and why each lever works. Open when choosing levers or designing a scheduled workflow.
- `reference/case-study-private-app-2026-09.md`: a worked example with real numbers, the restructure chosen and its expected billed minutes per trigger. Open to sanity-check your own estimates or to see what a finished audit looks like.

## Read-only guarantee

Every `gh` call passes through one function that refuses anything except `gh api --method GET` (and `gh repo view` for the default repo). It rejects `-X`, `-f`, `-F`, `--field`, `--raw-field` and `--input`. The script never changes a workflow, a setting, a token or an auth scope. If an endpoint is refused for a missing scope, the report records the error and continues with what is readable.

## Portability

No repo-specific code, names, dates or thresholds. The script takes the repo and every job name as arguments. Install it with the repo's `install.sh` (which links it into `~/.claude/skills/`), or copy this folder unchanged into any project's `.claude/skills/`.
