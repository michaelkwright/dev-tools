# Requests, budgets and model swaps

What a request sends is the half of a model call that tests see least: a stubbed HTTP call answers whatever its fixture says, whatever the body contained. These rules size the budget, shape the body per model, and make a model change a code change with its own proof.

---

**Thinking tokens count against `max_tokens`, so size each ceiling per model by a rule over logged output tokens.**
Why: a ceiling sized for a model that never thinks truncates the day thinking uses it, and that truncation reads as a prompt or parser failure.

- The fact itself, and the per-model thinking defaults, are in `reference/api-facts.md`.
- Write the rule down and apply it per call kind: for example, the larger of the current ceiling and the largest logged output-token count for that kind, times a stated margin. A hand-picked number cannot be re-derived when the model changes; a rule can.
- Log the thinking-block count (and, where the usage carries it, the thinking-token count) on every call, so the ceiling's basis is in the log rather than in someone's memory.
- Truncation and a missing answer can have the same root cause: a thinking block that consumed the ceiling. Raising the ceiling fixes the symptom; read the block types before deciding which problem you have.

**Build request parameters per model, and when adding a model's parameter set, keep a byte-identical comparison of the bodies for every model you did not touch.**
Why: one model can reject a parameter another requires, so a single shared body is wrong for at least one of them, and a change for one model that leaks into an untouched model's body is a silent behavior change there.

- Keep one parameter set per model id in one module, applied as each request builder's last step, and throw on an unknown model id rather than sending a default body.
- Let a probe override the model only through the shipping builder's own parameter. A probe that re-models by spreading over a built body skips the parameter set and sends the old model's body to the new one.
- Pin the untouched models' bodies with a snapshot or fixture comparison, and break-probe it by giving an untouched model the new parameter.

**A model swap is a code change first: reader, ceilings and test mocks move in the same change.**
Why: mocks that encode the old model's one-text-block envelope keep the whole suite green through the change that breaks production.

- Before pointing any call site at a newer model, read through the trailing-text reader (`reference/reading-responses.md`), size the ceilings by rule, and migrate every response mock to each envelope shape the new model can return (`[text]`, `[thinking, text]`, `[redacted_thinking, text]`).
- Enumerate every request-building site first, including operator scripts and probes, and swap all sites that answer the same question together; two models answering the same question produce two shapes of stored output.
- Re-read the target model's migration guide; never carry the last model's facts across.

**Verify a model swap by repeated draws against the real model, never by one smoke call.**
Why: a reply shape that depends on whether the model chose to think is a rate, not a constant, so the first draw can come back clean while one request in several fails forever after.

- Size the draw set to see the rate you care about, and grade against the stored output of the old model for the same input.
- State the pass bar before the run: for example, zero thinking blocks on every tool-free draw, every draw valid, only `end_turn`.
- `runner/draw-runner.ts` runs the draws under caps and counts them by stop reason, block shape and parse outcome.
- The spend rules for that run are in `reference/spend-and-logging.md`.

**A change to the request body needs one live call, because tests that stub the HTTP call cannot see it.**
Why: an unsupported parameter, a prefilled assistant turn or a wrong model id fails every request with a 400 while typecheck, build and the whole suite stay green.

- The failure is total and quiet: each call lands in the ordinary upstream-error branch, logs a plausible failure row, returns the usual soft fallback and throws nothing.
- After a body change, one minimal live call proves the request is accepted; a change to response handling alone does not need one. The call still follows the spend rules.
- When a body mistake is one a later session is likely to reach for (prefilling the assistant turn to force JSON, on a model that refuses prefill), add a source contract that forbids it and quotes the provider's error, so the decision is made deliberately rather than rediscovered by shipping.

**A prompt defect is a distribution: settle it by N draws, never by one draw or by reading.**
Why: whether the model answered badly or the validator discarded a good answer is a rate over draws, and one draw or a careful read of the prompt answers a different question.

- Run the shipping prompt, through the shipping builder, N times against the same input, and count each outcome (`runner/draw-runner.ts`).
- Grade a prompt change against enough items to see variance; two graded items can both come out on the same side of a coin flip.
