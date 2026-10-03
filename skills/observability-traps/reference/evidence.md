# Evidence

What a counter, a timestamp, a row or a row count can and cannot prove. Read before treating any stored value as proof that something happened.

## Already in the project's `CLAUDE.md`

A project set up with the project-bootstrap skill carries two of these rules in its Database block: a value in a column is not evidence that the action which normally writes it happened, and a timestamp column proves nothing until something is confirmed to write it. In a project that was not bootstrapped, read them in `skills/project-bootstrap/templates/CLAUDE.md.tmpl` in this dev-tools checkout. The detail below extends them.

- A value proves an action only if that action is the column's sole possible writer. If a client can write the column, or a trigger stamps a companion timestamp whenever it changes, a forged write and a real one leave identical rows. Lock the column's write privileges (the dev-tools `supabase-hardening` skill), or treat the value as a claim.
- Before reading a timestamp as activity, find the trigger or the explicit update that writes it. An `updated_at` with neither equals `created_at` forever, and reading that equality as "nothing happened" builds a whole diagnosis on a column nobody maintains.

---

**A counter increments inside the branch that confirms the action succeeded, never in the loop over candidates.**
Why: a counter per candidate considered reports a clean run when nothing happened; a cleanup that counted every flagged row as removed reported success while the objects it should have deleted survived.

- When writing or reviewing a bulk cleanup, archive or repair job, read where each counter increments. Pin it with a test where some candidates are skipped and the count must come out lower than the candidate count.

**In a low-traffic app, an unexplained row-count change between two reads is an event to trace, not noise.**
Why: with a handful of real users "probably concurrent activity" is not an available explanation, and the cause (a scheduled run, a test record, a probe's own output) is always findable.

- Find the event before writing the delta off as drift. A test record created to trigger a job leaves its own rows behind; expect that residue in the verification step rather than discovering it as a delta.

**A log row dated before a change is not evidence about that change; check the timestamp ordering before reading a green row as confirmation.**
Why: a scheduled run that logged `ok` an hour before a secret rotation exercised the old secret and says nothing about the new one.

**Filter a shared call log by an origin marker in its structured metadata, never by action name alone.**
Why: test probes and internal invocations share the action name with the real path, so a count by action over-counts the feature's real use.
