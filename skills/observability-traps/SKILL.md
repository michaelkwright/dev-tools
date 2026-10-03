---
name: observability-traps
description: Use when reading product usage data (an insight, a funnel, a session tool) or a health digest; when treating a counter, timestamp or row as evidence that something happened; when debugging a failure nobody noticed; when instrumenting a scheduled job or its watchdog; or when reading platform CPU and memory metrics.
---

# Observability traps

Signals that look like evidence and are not: counters, timestamps, empty results, scheduler ledgers, product-usage noise and resource readings. Each rule below names the trap and what to read instead; each points to the reference file that holds the detail. Ships a heartbeat table and a read-only watchdog query, proven by a PGlite harness.

## Already elsewhere

- A project set up with the project-bootstrap skill carries two evidence rules in its `CLAUDE.md` Database block: a value in a column is not evidence that the action which normally writes it happened, and a timestamp column proves nothing until something is confirmed to write it. Follow them there; `reference/evidence.md` holds the detail. In a project that was not bootstrapped, read the same block in `skills/project-bootstrap/templates/CLAUDE.md.tmpl` in this dev-tools checkout.
- The unchecked-result shape (a client that returns its error instead of throwing) is recipe (a) in the dev-tools `ratchet-tests` skill, and its Postgres-client instance is in the `supabase-hardening` skill.
- The fields of a per-call model log belong to the dev-tools `llm-call-hygiene` skill (planned).

## Checklist

### Evidence

**A counter increments inside the branch that confirms the action succeeded, never in the loop over candidates.**
Why: a counter per candidate reports a clean run when nothing happened. → `reference/evidence.md`

**In a low-traffic app, an unexplained row-count change is an event to trace, not noise.**
Why: with a handful of real users the cause is always findable, and "concurrent activity" is not available as an explanation. → `reference/evidence.md`

**A log row dated before a change is not evidence about it; check the timestamp ordering first.**
Why: a green run from before a secret rotation exercised the old secret. → `reference/evidence.md`

**Filter a shared call log by an origin marker, never by action name alone.**
Why: test probes share the action name with the real path and inflate every count. → `reference/evidence.md`

### Silent failures

**An outcome log must tell "ok with an empty result" apart from a genuinely empty answer.**
Why: a failed read that degrades to an empty list writes the same success row as a night with nothing to do. → `reference/silent-failures.md`

**A volume gate binds before the read that builds the list, over the same rows that read will include.**
Why: a gate counting rows the list later drops admits callers whose list is empty. → `reference/silent-failures.md`

**Make a failure visible before making it rare: instrument before adding a cap, a limit or a retry.**
Why: a blind retry spends an attempt and teaches nothing. → `reference/silent-failures.md`

**An error report names the specific fault and carries no user content and no model text, including in its cause chain and tags.**
Why: error reporters walk `cause` by default, so a raw error attached there ships the row it touched. → `reference/silent-failures.md`

### Scheduled jobs

**Every run writes a heartbeat row on entry and closes it with its outcome.**
Why: from outside, a job that never fires and a job with nothing to do both leave no trace. → `reference/scheduled-jobs.md`, `templates/job-heartbeat.sql.tmpl`

**A rehearsal (dry) run's heartbeat never counts as fresh.**
Why: a hand-run rehearsal would mark a schedule that never succeeded as healthy. → `reference/scheduled-jobs.md`

**The watchdog checks heartbeat freshness AND the scheduler's own failure ledger, as separate findings.**
Why: a job that dies before its heartbeat leaves no row, and one that fails intermittently stays fresh. → `reference/scheduled-jobs.md`, `templates/job-heartbeat.sql.tmpl`

**For a job dispatched over HTTP, the scheduler's ledger proves only that the request was queued; the job's own heartbeat is the proof of work.**
Why: pg_net queues the request and returns at once, so the ledger reads `succeeded` whatever the function did. → `reference/scheduled-jobs.md`

### Product usage and platform metrics

**Suppress rageclicks on repeat-press controls by selector, and leave autocapture on.**
Why: working steppers and calendar arrows bury the rageclicks that mark a stuck control. → `reference/usage-and-platform-metrics.md`

**A failure that splits 100% / 0% by account points at the client environment, not the code path.**
Why: identical code failing for every account on one browser engine is not a regression in any commit. → `reference/usage-and-platform-metrics.md`

**Read CPU and memory from the platform's own shutdown or termination record, never from a wall-clock or in-process proxy.**
Why: stage timers miss the work around their spans, and in-process memory readings can report zero or the heap alone. → `reference/usage-and-platform-metrics.md`

## Template

`templates/job-heartbeat.sql.tmpl` has two parts.

- Part 1 is the migration: a heartbeat table (job name, started and finished times, outcome, detail), revoked from `PUBLIC`, `anon` and `authenticated`, granted to `service_role` only, with RLS on and a closing `DO` block that re-checks the raw ACL and raises. Copy it into the project's migrations folder, fill `{{DEV_TOOLS_SHA}}` with the short HEAD of this dev-tools checkout, rename the table and the example jobs, and apply it as one paste in the dashboard SQL editor.
- Part 2 is the watchdog query: one read-only `SELECT` returning one row per finding (`finding`, `job_name`, `detail`). MISSING is an active job with no ok, non-dry-run heartbeat inside its freshness window. FAILED is scheduler-ledger failures inside the lookback, at most one row per job. The window, the lookback and any per-job window overrides are parameters at the top. It reads `cron.job` and `cron.job_run_details`, which the Data API does not expose, so a watchdog that calls it over the Data API needs it wrapped in a `service_role`-only function (the `supabase-hardening` new-function template).

The ACL steps follow the `supabase-hardening` skill; its rules on revoke-first and the in-migration check apply here unchanged.

## Harness

`watchdog/test/` runs on PGlite with a stubbed `cron` schema and Supabase's default privileges, so it needs no Docker and no live database. From a dev-tools checkout, run `npm install` and then `npm test`. It proves:

- a healthy job yields no finding; a job with no heartbeat in its window yields MISSING; a job that fails intermittently but stays fresh yields FAILED and not MISSING; a job whose only recent heartbeats are non-ok yields MISSING;
- the edges: a never-instrumented job, a fresh dry run, an inactive job, a job unscheduled since it failed, a per-job window override, and that no command text reaches a finding;
- break probes, each shown clean first: deleting the FAILED branch, counting non-ok heartbeats as fresh and removing the window filter each change the query's result, and dropping the revoke makes the `DO` block raise and roll the paste back.

A renamed copy is new text, so its own `DO` block is still the check that counts.

## Reference files

Open these from this folder when needed:

- `reference/evidence.md`: what a value, a timestamp, a counter, a row count or a log row can prove. Open before treating any stored value as proof.
- `reference/silent-failures.md`: empty-result outcomes, volume gates, instrumenting before limiting, and error reports. Open when debugging a failure nobody noticed, or before writing a job's outcome log or an error report.
- `reference/scheduled-jobs.md`: heartbeats, dry runs, the two-sided watchdog, HTTP-dispatched jobs. Open before scheduling or instrumenting a job.
- `reference/usage-and-platform-metrics.md`: rageclick noise, account-level splits, and platform CPU and memory. Open before reading a product-usage insight, a digest or a resource metric.
