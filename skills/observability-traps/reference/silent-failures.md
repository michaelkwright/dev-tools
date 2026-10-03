# Silent failures

A failure nobody noticed is usually a failure that looked like success. These rules make a broken run look different from a quiet one, and make the report of a fault useful without leaking what it touched.

---

**An outcome log must tell "ok with an empty result" apart from a genuinely empty answer.**
Why: a failed read that degrades to an empty list produces a run that reports success, writes the same log row as a night with nothing to do, and tells the caller to stop.

- `const { data } = await client.rpc(...)` turns a failed call into `undefined`, `(data ?? []).length` into 0, and "nothing remaining" into `done: true`. A nightly order archive whose queue read failed and one with an empty queue then write byte-identical heartbeats. Read the error and throw.
- Give "the input was empty, so nothing was attempted" its own outcome value. A model call made with an empty item list still returns fluent text, which a log that only knows `ok` records as a success.
- A fill-only guard that matches zero rows (an `is null` test on a column that also stores an empty array) reports a clean run with nothing written. Test every representation of "empty" the column holds.
- The unchecked-result shape behind the first bullet has a ratchet recipe in the dev-tools `ratchet-tests` skill (recipe (a)), and its Postgres-client instance is in the `supabase-hardening` skill.

**A volume gate binds before the read that builds the list, and counts over the same rows that read will include.**
Why: a gate that counts rows the list later excludes admits a caller whose list is empty, and one placed after the read lets anyone who is refused still make the server do the expensive scan.

- Write the inclusion rule once, as one predicate both the gate and the read use. A gate counting a user's items, placeholder rows included, while the list dropped them, passed users on placeholders alone.
- Order: cache, then gate, then the read that builds the list, then the empty-input guard, then the paid call. A cache hit makes no upstream call and must not spend budget.

**Make a failure visible before making it rare: instrument before you add a cap, a limit or a retry.**
Why: a blind retry spends an attempt and teaches nothing, and a cap set before anything is measured is set on a guess.

- Capture the raw failure (a capped head of the response, its length, a coarse kind) on the failure path before spending a job's last retry, so a counted failure becomes an examined one.
- A per-call log, written for every call and kept, turns "why did this fail last Tuesday" into one lookup instead of an investigation. The fields a model-call log needs are in the dev-tools `llm-call-hygiene` skill (`reference/spend-and-logging.md`).
- Filter a shared call log by an origin marker in its metadata, never by action name alone (`reference/evidence.md`).

**An error report names the specific fault and carries no user content and no model text, including in its cause chain and its tags.**
Why: error reporters walk `cause` by default, so a raw database error attached as the cause ships whatever row content it carried, whatever the top-level message says.

- Build the cause as a plain copy of the fault's message and code, never the raw error object.
- Normalize a non-`Error` value before reporting it. A database client's error is often a plain object, and capturing one as an exception loses its message; wrap it in an `Error` with its message and fingerprint by its code, so each call site stays its own issue.
- Tags and fingerprints are shared, non-personal values: an action name, a code, a stage. Never what a user typed or what a model wrote.
- Strip request bodies and free-form extras in the reporter's send hook as well, as a property of the transport rather than of today's call sites.
- The internal call log may keep a capped raw model response for diagnosis; the error reporter never does.
