# Reading the response

A model reply is an array of typed blocks plus a stop reason, and most reading bugs come from treating it as one string. These rules decide which blocks hold the answer, when not to parse at all, and how to keep every failure named. `helpers/message-reading.ts` implements the first five; the API facts they rest on are in `reference/api-facts.md`.

---

**Read the trailing run of text blocks, never a fixed index.**
Why: a thinking-capable model puts a thinking block first, so `content[0].text` is undefined, the reply is filed as malformed output, and the answer was one block later.

- The trailing run is every text block after the last block of any other type, joined. For a reply that is one text block it is byte-identical to `content[0].text`, so the change is safe to make before any model swap.
- It is probabilistic: under adaptive thinking a model thinks on some requests and not others, so one clean draw proves nothing. A reader that worked for months on a model that never thinks fails a fraction of requests the day the model changes.
- A reply that ends in a thinking block (cut off at the ceiling) has no answer; the reader returns null rather than an earlier text block.
- Guard it: `guard/fixed-index-read/` is an invariant ratchet that fails on any fixed-position read of a response's content array.

**Check the stop reason before extracting or parsing, and refuse a truncated reply even when its text would parse.**
Why: a reply cut off at the ceiling is a budget failure, and parsing it first files it as a parser error, which sends the investigation to the prompt instead of the token budget.

- Detect truncation before the parse, not from the parse's exception. A caught `SyntaxError` produces the same outward response either way, so an outcome-only test passes against the bug; assert that a truncated envelope produces zero parses.
- A reply whose JSON happens to be complete at the cut is still refused: it ended because it ran out, not because it finished, and a later draw of the same request will not be so lucky.

**Map every stop reason by name, keep an unknown one verbatim, and treat only a pause as retryable, never through a continuation loop.**
Why: a new value mapped onto the nearest known name hides exactly the change someone needs to see, and continuing a paused turn is a second billed request that spends a cap nobody approved.

- The documented values and their meanings are in `reference/api-facts.md`. A null stop reason on a non-streaming reply is unexpected, not "done".
- Retrying a pause is the caller's decision, made once, inside the same caps as the first request. A refusal is not retryable as the same request; the docs' fallback to a different model is a separate design choice.

**Classify and name every failure, and carry no model text in any of them.**
Why: one generic failure kind for a truncation, a refusal and a malformed reply sends each investigation to the wrong layer, and a failure is logged and reported, so model text in it ships with the report.

- The helper's kinds: `truncated`, `context_exhausted`, `stop_sequence`, `tool_call`, `paused`, `refused`, `unexpected_stop`, `tool_blocks`, `no_text`, `not_json`. Each carries the raw stop reason and the block types in order; a `not_json` failure carries the text's length, never the text.
- The JSON parser's own error message quotes the input it rejected. Drop it; never copy it into a failure.
- Where diagnosis needs the raw reply, keep a capped head in the internal call log only. The error-report rule this follows is in the dev-tools `observability-traps` skill (`reference/silent-failures.md`).

**Parse the whole text strictly, and rescue only a wrapper shape you have measured, counting each rescue.**
Why: a tolerant extractor (strip anything, scan for the first brace) turns a reply that stopped obeying the prompt into a silent success; a narrow, measured exception keeps every other degradation visible.

- `JSON.parse` over the whole trailing text; surrounding whitespace is fine because the parser allows it.
- A measured exception is the method, not a loosening. A strict rule like this one gets reversed in narrow steps on evidence: exactly one code fence around the whole reply, once live replies showed models fencing despite the prompt; exactly one leading line of prose, once the API's own citation boundaries were shown to put an uncited sentence at the head of the answer's block. Each rescue admits the one shape measured, with both ends required, and everything else stays refused: prose after the JSON, two values, an unclosed fence, a fence around non-JSON.
- Log whether the rescue fired, as its own field, on every call that reaches the parse. A rising rescue count is a prompt drifting, and a rescued failure must stay distinguishable from one where the wrapper was never the problem.
- The helper ships one opt-in rescue, the single fence, and reports `rescue: "fence"`.

**A reply carrying tool or search blocks gets its own reader.**
Why: a search turn interleaves tool-call and result blocks between text blocks, so the trailing run is the wrong shape for it, and a parser that sees it as text reads half an answer.

- The helper refuses such a reply with `tool_blocks` rather than guessing; an unknown block type is refused the same way.
- Keep extraction and judgement apart: the reader returns every citation, result and error it finds with its block index, the block types in order, the stop reason and the usage; deciding what the evidence means is a separate step.

**Count billed searches from the usage fields, never by counting blocks.**
Why: the usage field is what is billed, and a block count miscounts a turn that retried a search internally.

**A tool result that is an error object is an error, never an empty result.**
Why: read as "no results", a rate limit or an outage is indistinguishable from a search that genuinely found nothing, and every downstream rule then records an infrastructure fault as a fact about the item.

- Keep the error code and the id of the call it answers, so an error ties back to its query.
- The error and empty-success shapes are in `reference/api-facts.md`.

**The tool version is a decision, not a default.**
Why: a newer version can change a default (for web search, who may call the tool), which changes which blocks reach the reader and what any check over them can see.

- Pin the version you measured, record why, and treat a version change like a model swap (`reference/requests-and-models.md`).
