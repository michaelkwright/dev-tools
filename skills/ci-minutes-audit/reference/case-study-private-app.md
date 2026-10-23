# Case study: one private repo, two consecutive months

A worked example of the method: measure with `ci-minutes.mjs`, pick levers from the numbers, restructure. The repo (a solo-built React + Supabase app, private) ran one `CI` workflow on `ubuntu-latest` (Linux, multiplier 1), with a mandatory local full-suite gate and CI as reporting only.

## Totals

| Measure | First month | Second month (to late month) |
| --- | --- | --- |
| Runs | 49 | 213 |
| Billed minutes (computed) | 614 | 2,002 |
| Raw job minutes | 536.3 | 1,773.2 |
| Blocked runs | 0 | 75 (150 jobs) |

CI existed from the middle of the first month. The account's included minutes ran out late in the second month. This repo alone reached about 2,000 computed minutes at that point; other private repos share the account pool and could not be measured, so that is consistent with, not proof of, the quota being the cause. Every blocked job carried a check-run annotation saying it was never started because of a payment or spending-limit problem; it does not mention the included-minutes quota. Had the 75 blocked runs run, at the median of about 14.8 billed minutes each they would have added an estimated 1,110 minutes.

## Second-month shares

By job (billed minutes, 2,002 total):

| Job | Minutes | Share |
| --- | --- | --- |
| The primary-timezone suite leg | 886 | 44.3% |
| The second-timezone leg | 842 | 42.1% |
| Typecheck and build | 263 | 13.1% |
| A 7-second decision job | 8 | 0.4% |
| The docs-only job | 3 | 0.1% |

By step category (share of step time in jobs that ran): test 84.5%, build 7.2%, install 5.6%, setup 2.7%. A `cache: npm` setting already existed on all three installing jobs.

The second-timezone leg ran on every push until a change reached CI late in the second month. The 130 runs before it billed 1,947 minutes (about 14.98 per run); the 8 billed runs after it billed 55 (about 6.9 per run).

Rounding overhead (billed minus raw): 228.8 minutes, 11.4% of billed (first month 77.7, 12.6%). 18 jobs under 60 seconds each billed a whole minute.

## The four what-if estimates (second month; overlapping, not additive)

| Lever | Estimate |
| --- | --- |
| Skip docs-only runs entirely | 3 docs-only runs, 6 min, 0.3% |
| `cancel-in-progress` | 2 superseded runs ran to completion, about 12.5 raw minutes still escaping it, 0.6% (already configured) |
| Nightly-only full suite | 2,002 minus 250 = 1,752 min, 87.5% (the second month's baseline understated by the blocked period) |
| Install share / dependency cache | 5.6%, about 113 min (cache already configured) |

Only the third mattered, and the audit's by-job table explained why: a second timezone leg on every push, plus a per-job round-up on three jobs per push.

## The restructure chosen

Per push: ONE job, typecheck and build (checkout, setup-node with npm cache, `npm ci`, `npm run build`), no tests, `timeout-minutes: 10`, least-privilege token, and workflow-level `paths-ignore: ['**.md']` (after confirming the build reads no Markdown). A separate scheduled workflow runs the full suite once a day at a non-round minute with skip-if-unchanged, on the primary timezone six days a week, and as a two-timezone matrix one day a week (two cron lines, so no decision job is needed); manual dispatch always runs both legs; `timeout-minutes: 15`. The decision job and the docs-only job were retired.

Expected billed minutes, walked by hand from the second month's durations (typecheck and build about 81 s mean, 93 s max; each suite leg about 380 s, 442 s max):

| Trigger | Expected billed minutes |
| --- | --- |
| Markdown-only push | 0 (no run is created) |
| Mixed push (any non-Markdown path) | 2 |
| Single-timezone schedule tick | 1 if the commit already passed (skipped), 7 if it ran the suite |
| Weekly two-timezone tick | 2 (both legs skip), 14 (both run), about 8 (one skips, one runs) |
| Manual dispatch | 14 |
