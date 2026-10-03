# Prompt inputs

What goes into a prompt decides what can come out, and most prompt bugs are an input the author never saw rendered. These rules keep the prompt server-built, bound untrusted text, and test the prompt itself rather than the answer it happened to produce.

---

**Never relay client-authored prompt or instruction text: build the prompt on the server, and ignore the old field rather than rejecting it.**
Why: prose cannot be validated, so a relay behind nothing but a valid session is an open model endpoint on the project's key; and a 400 on a stale field breaks every client still sending it.

- The fix is irrelevance, not validation: read the inputs the feature needs (an order id, a date) and build the prompt from server-read data. Assert the allow-list of request fields the handler reads, not a deny-list of forbidden ones.
- A path that keeps part of a client string (replacing only its tail after a marker) is still a relay.
- Building the prompt on the server moves the isolation burden with it: a query written for the browser was scoped by row-level security with nothing in its text saying so, and on a service-role client it reads every user's rows. Put an explicit ownership filter on every server-side read that feeds a prompt, and prove it by executing the handler against a two-user fixture.
- Bounded, purpose-specific fields interpolated into a server-built prompt (a short delivery note, a chat message that is the feature) are a different category; bound each one, and frame it as information, not instruction.

**Put untrusted text in the prompt once, inside a delimited container, labelled as data.**
Why: naming the value once bounds what a hostile value can reach, and every later mention of "the named item" instead of the value keeps it from being interpolated into instructions.

- For example, `<item_name>…</item_name>` followed by an instruction to treat the contents as data and ignore anything inside that reads as a direction.
- Check what can come back as well: the validator for the output should already bound its length and shape, so the user's text reaches the prompt and never the stored value.

**Check your own prompt wording against a deny-list in tests, never at runtime against user text.**
Why: the deny-list asks whether the builder's own words carry a forbidden term, and a runtime check over user text refuses legitimate input that happens to contain one.

- Parse the list out of its one source in the test, so there is no second copy to drift; exempt the user's value; and break-probe by planting a term in the builder's own wording.

**Name every output convention the reader depends on (units, date format, casing) in the prompt.**
Why: an unstated convention is a coin flip per call, visible only across a sample, so two graded rows can agree while the next five come back in the other convention.

**A date in a prompt is the user's local date, never the server's.**
Why: the server's UTC date is already tomorrow for a user in the evening, so "today" in the prompt is wrong for part of every day.

- Send the client's local calendar date (and time zone) with the request, validate it as a real date, and fall back to the server clock only when it is absent.
- Pin it with a test under a fixed instant and two time zones where the UTC date differs from the local one.

**Assert the rendered prompt, not the downstream output.**
Why: a correct-looking answer is not evidence the prompt carried the value; a model can produce the expected answer from its own knowledge while the prompt reads `[object Object]`.

- Capture the fully assembled prompt from the shipping builder and assert the value is in it, formatted as intended.
- For a port or refactor of prompt-building code, capture the old builder's output as a golden baseline in its own commit before any production line changes, then require the new code to reproduce it byte for byte.

**Send per-session flags on every turn, so the cached prefix stays stable.**
Why: a flag that changes the system text applies to the cached prefix, so a flag sent on the first turn and dropped on the next changes the prefix and misses the cache for the rest of the conversation.

- Assert that the assembled system text is byte-identical with the flag absent, so adding the flag changes nothing for callers that never send it.

**Derive an output schema from the validator, and leave to the validator what a schema cannot express.**
Why: a hand-written schema beside a validator is a second copy that drifts, and lengths, uniqueness and word rules a schema cannot state still need the validator's check.

- Constrained decoding can change other parts of the reply. Measure the same request with and without it (one variable) before relying on it alongside citations or tools.

**A model never grades its own output: cross-check in code against the API's record of what it was shown.**
Why: a model's own list of sources or its confidence flag is more of its output, so using it as evidence is self-report.

- Corroborate from the citations and tool results the API attached to the reply, in code, by a rule written down before the run.
