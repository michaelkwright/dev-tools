# Case study: one private repo, August and September 2026

A worked example of the method: measure with `ci-minutes.mjs`, pick levers from the numbers, restructure. The repo (a solo-built React + Supabase app, private) ran one `CI` workflow on `ubuntu-latest` (Linux, multiplier 1), with a mandatory local full-suite gate and CI as reporting only.

## Totals

| Measure | August (1-31) | September (1-29) |
| --- | --- | --- |
| Runs | 49 | 213 |
| Billed minutes (computed) | 614 | 2,002 |
| Raw job minutes | 536.3 | 1,773.2 |
| Blocked runs | 0 | 75 (150 jobs) |

CI existed from Aug 15. The account's included minutes ran out in September: the last run that billed was 2026-09-23 05:01 UTC and the first blocked run was 2026-09-24 01:37 UTC. This repo alone reached about 2,000 computed minutes at that point; other private repos share the account pool and could not be measured, so that is consistent with, not proof of, the quota being the cause. Every blocked job carried the annotation "The job was not started because recent account payments have failed or your spending limit needs to be increased." Had the 75 blocked runs run, at the median of about 14.8 billed minutes each they would have added an estimated 1,110 minutes.

## September shares

By job (billed minutes, 2,002 total):

| Job | Minutes | Share |
| --- | --- | --- |
| Test (TZ=America/New_York) | 886 | 44.3% |
| Test (TZ=Asia/Tokyo) | 842 | 42.1% |
| Typecheck & Build | 263 | 13.1% |
| Decide CI path (a 7 s job) | 8 | 0.4% |
| Test (docs-only) | 3 | 0.1% |

By step category (share of step time in jobs that ran): test 84.5%, build 7.2%, install 5.6%, setup 2.7%. A `cache: npm` setting already existed on all three installing jobs.

The Tokyo leg ran on every push until a mid-month change reached CI on Sep 22. The 130 runs before it billed 1,947 minutes (about 14.98 per run); the 8 billed runs after it billed 55 (about 6.9 per run).

Rounding overhead (billed minus raw): 228.8 minutes, 11.4% of billed (August 77.7, 12.6%). 18 jobs under 60 seconds each billed a whole minute.

## The four what-if estimates (September; overlapping, not additive)

| Lever | Estimate |
| --- | --- |
| Skip docs-only runs entirely | 3 docs-only runs, 6 min, 0.3% |
| `cancel-in-progress` | 2 superseded runs ran to completion, about 12.5 raw minutes still escaping it, 0.6% (already configured) |
| Nightly-only full suite | 2,002 minus 250 = 1,752 min, 87.5% (September's baseline understated by the blocked period) |
| Install share / dependency cache | 5.6%, about 113 min (cache already configured) |

Only the third mattered, and the audit's by-job table explained why: a second timezone leg on every push, plus a per-job round-up on three jobs per push.

## The restructure chosen

Per push: ONE job, Typecheck & Build (checkout, setup-node with npm cache, `npm ci`, `npm run build`), no tests, `timeout-minutes: 10`, least-privilege token, and workflow-level `paths-ignore: ['**.md']` (after confirming the build reads no Markdown). A separate scheduled workflow runs the full suite once a day at 07:17 UTC (non-round minute) with skip-if-unchanged, on the New York timezone Tuesday to Sunday, and as a two-timezone matrix on Mondays (two cron lines, so no decision job is needed); manual dispatch always runs both legs; `timeout-minutes: 15`. The "Decide CI path" and docs-only jobs were retired.

Expected billed minutes, walked by hand from September's durations (Typecheck & Build about 81 s mean, 93 s max; each suite leg about 380 s, 442 s max):

| Trigger | Expected billed minutes |
| --- | --- |
| Markdown-only push | 0 (no run is created) |
| Mixed push (any non-Markdown path) | 2 |
| Weekday schedule tick | 1 if the commit already passed (skipped), 7 if it ran the suite |
| Monday schedule tick | 2 (both legs skip), 14 (both run), about 8 (one skips, one runs) |
| Manual dispatch | 14 |

## Post-change actuals: pending verification after the October 1 billing reset

Nothing above has run on GitHub's runners. The account's quota was exhausted and every run since Sep 24 was billing-blocked until the quota resets on October 1, 2026. After the reset, verify the expected minutes in the table above against the analyzer's output for a comparable period and record the actuals here. Until then every figure in the restructure section is an estimate.
