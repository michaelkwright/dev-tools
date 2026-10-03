# Logging and spend

A model call costs money and leaves one chance to record what it did. These rules make every call answerable after the fact and keep a paid run inside a cap enforced by code.

---

## Already elsewhere

- Stating an estimated cost and a matching spend cap before any prompt that spends a pay-as-you-go key, and preferring a subscription surface (a chat or Claude Code) for offline evaluation, grading, analysis and seeding, are in the optional `llm` block of the dev-tools `project-bootstrap` skill's planning instructions (`templates/claude-ai-project-instructions.md.tmpl`). Follow them there; this file adds what the estimate and the cap must contain.
- Filtering a shared call log by an origin marker, never by action name alone, is in the dev-tools `observability-traps` skill (`reference/evidence.md`).
- The rate-limit RPC's own shape (a locked counter row, a server-clock bucket, `service_role` only, fail closed) is in the dev-tools `supabase-hardening` skill (`reference/edge-functions-and-storage.md`).

---

**Write one log row per model call: outcome, stop reason, input and output tokens, model, effort, thinking-block count, prompt version and origin marker.**
Why: every later question (did it think, which prompt produced it, was it a probe) is answerable only from a field recorded at call time, and a call with no row is invisible.

- Record the stop reason and the failure kind separately from the outcome, so a truncation and a refusal are two rows, not two `failed` rows.
- Record each rescue the reader applied (a stripped fence) as its own field (`reference/reading-responses.md`).
- Record the effort and the thinking-block count even on a call that failed or sent nothing, as null or zero, so a missing value means "not sent", never "not logged".
- Record the model per row. A swap is otherwise invisible in the log, and the price of a row depends on it.

**Give each prompt kind its own version, bumped with a snapshot of its rendered text.**
Why: one shared version constant moves for every kind when one changes, so it can no longer tell which outputs came from which text, and a text change without a bump is invisible in the log.

- A snapshot test that fails when a kind's rendered text moves without its version, or its version without its text, holds the two together.
- The version follows the prompt text, not the model: a model swap with no text change does not bump it.

**Run the rate limit before any paid call, and put a cache hit above it.**
Why: a limit checked after the call has already spent, and a cache hit makes no upstream call and must not consume the caller's budget.

- The full ordering (cache, then the gate, then the read that builds the input, then the empty-input guard, then the paid call) is the volume-gate rule in the dev-tools `observability-traps` skill (`reference/silent-failures.md`).
- Every paid egress passes the same limiter; never add a second mechanism beside it.

**Before any paid run: an estimate, a dry-run worst case, and hard caps on requests and dollars checked before each call from the usage fields.**
Why: an estimate is a hope, and a cap checked after the fact has already been exceeded; only a gate before each call that adds that call's worst case holds.

- The dry run builds every request the run would send, makes no call, and prints the count and the worst case: each request as sent, at its full `max_tokens`, at list price.
- The gate before each call refuses it when dollars spent so far, read from the usage fields of the calls already made, plus this call's worst case, would exceed the cap. A call whose outcome is unknown (a timeout) counts at its worst case.
- A worst case for a request carrying a server-side search tool includes the injected search-result input tokens: results are fed back as input, so the billed input can be ten times the request as sent. Budget per allowed search (the tool's maximum uses), not per expected search, until a measured figure replaces it.
- Price every model the run touches from a recorded list-price table with its read date; a model with no recorded price stops the run rather than being priced at zero.
- Report actual tokens and dollars afterwards, beside the estimate.

**A paid harness records everything the run returned that a later question could need.**
Why: the paid call is the expensive part and a wider record is free, while a field nobody recorded can only be recovered by paying again.

- Record the raw text where a parse is in question, every evidence item rather than the first per source, every citation with its title and cited text, the block types, the stop reason and the usage.
- Before any new draw, replay what the recorded draws already answer, then check what they do not hold by reading the files, not their description.
