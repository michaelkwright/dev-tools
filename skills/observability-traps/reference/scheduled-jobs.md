# Scheduled jobs

How a scheduled job proves it ran, and how a watchdog notices when one did not. `templates/job-heartbeat.sql.tmpl` holds the heartbeat table and the watchdog query; `watchdog/test/` proves both.

---

**Every run writes a heartbeat row on entry and closes it with its outcome, `ok` or `failed`.**
Why: from outside, a job that never fires and a job that fires with nothing to do both leave no trace, and only a row written by the job tells them apart; a row written on entry also tells "never started" from "started and died".

- Close the row from every exit path, the failure path included, and put the counts the job already computed in its detail. A run that reports `ok` with all-zero counts is a healthy quiet night, which is exactly what the row exists to distinguish from silence.
- The job name in the row is the scheduler's job name, verbatim. It is the join key, and a typo produces rows nobody correlates and an absence nobody notices.
- The heartbeat write never fails the job it measures: read its error, log it, carry on. A failed heartbeat write leaves no row, which reads correctly as absence.

**A rehearsal (dry) run's heartbeat never counts as fresh.**
Why: a dry run still writes a heartbeat, so a hand-run rehearsal of a schedule that has never once succeeded marks it healthy for the whole freshness window.

- Mark it in the row (the template uses `detail.dry_run = true`) and exclude it in the freshness check, not by convention.

**The watchdog checks heartbeat freshness AND the scheduler's own failure ledger (`cron.job_run_details` for pg_cron), and reports them as separate findings.**
Why: a job that dies before its heartbeat, or whose failure rolls the heartbeat back, leaves no row to be stale, and a job that fails intermittently stays fresh; the scheduler records both, and the job cannot suppress that record by dying.

- A pure-SQL job runs inside one transaction under pg_cron, so a crash discards its own `started` row along with its work. Its failure is visible only in the ledger.
- Freshness asks "is the newest good run recent enough" and is bounded by false alarms: for a daily job checked at an arbitrary hour a healthy newest run is up to 24h old, so a window of 24h or less alarms on healthy nights, and a monitor that alarms daily gets ignored. The ledger lookback asks "did anything fail since I last looked" and is bounded by how long a failure must survive to be read, so it is longer than the watchdog's own interval.
- Aggregate ledger failures to one finding per job per run, keyed so repeats on later runs group as one issue. A job broken for three days must not become three alarms a day.
- Join the ledger to the job table with a left join, and label a missing job by its id. A job unscheduled because it was failing still had real failures.
- Never select the job's command text into a finding. It can carry a secret, and findings are sent on to whoever gets paged.
- A watchdog input it cannot read is a watchdog fault, never "no findings". Throw, fail the run and write a `failed` heartbeat; a null read that renders as an empty list is a green watchdog reporting nothing forever.
- The watchdog cannot witness its own absence. Give it an external check-in (a cron or uptime monitor that alarms when the check-in does not arrive), and do not grade its own freshness from inside it.

**For a job the scheduler dispatches over HTTP (pg_net), the ledger proves only that the request was queued; the job's own heartbeat, written inside the function, is the proof of work.**
Why: `net.http_post` queues the request and returns its id at once, and the request runs after the transaction commits, so the ledger reads `succeeded` while the function answers 401 or never runs at all.

- pg_net's response table (`net._http_response`) is not a substitute. It keeps responses for 6 hours by default, has no key back to the scheduled statement unless the command keeps the returned id, and can show a timeout for a slow request that actually succeeded.
- So the heartbeat has to record failures from inside the function too: a failed read or a thrown error closes the row `failed`. A request refused before the handler runs (a gateway 401, a wrong secret) writes no row at all, which the freshness check reports as MISSING. FAILED never sees these jobs' failures, so freshness is their only alarm.
