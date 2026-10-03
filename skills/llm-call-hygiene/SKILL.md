---
name: llm-call-hygiene
description: Use when writing or changing code that calls a model API or reads its response; when swapping or upgrading a model; when sizing max_tokens; when adding a paid batch, seed or probe run; when logging model calls or versioning prompts; or when building a prompt from user input.
---

# LLM call hygiene

A model call fails in ways the test suite never sees: an answer at the wrong index, a cut-off reply parsed as a bad one, a request body the API rejects behind a stubbed fetch, a paid run with no cap. Each rule below names the trap and the fix, and points to the reference file that holds the detail. Ships copyable response helpers for the Anthropic Messages API, a fixed-index-read guard built on the dev-tools `ratchet-tests` core, and a capped repeated-draw runner, all proven by a harness that makes no API call.

## Already elsewhere

- A project set up with the project-bootstrap skill carries two spend rules in its Claude.ai planning instructions (the optional `llm` block): state an estimated cost and a matching spend cap before any prompt that spends a pay-as-you-go key, and prefer the subscription for offline evaluation, grading, analysis and seeding. Follow them there; `reference/spend-and-logging.md` adds what the estimate and the cap must contain. In a project that was not bootstrapped, read the same block in `skills/project-bootstrap/templates/claude-ai-project-instructions.md.tmpl` in this dev-tools checkout.
- Filtering a shared call log by an origin marker, and keeping user content and model text out of error reports, are in the dev-tools `observability-traps` skill.
- The rate-limit RPC's own shape, grants and server-clock bucket are in the dev-tools `supabase-hardening` skill; this skill owns the call site.
- The ratchet rules the guard follows (both directions, structured keys, self-failure) are in the dev-tools `ratchet-tests` skill.

## Checklist

### Reading the response

**Read the trailing run of text blocks, never a fixed index.**
Why: a thinking-capable model puts a thinking block first, so `content[0]` comes back empty and the answer is misfiled as malformed output. → `reference/reading-responses.md`, `helpers/message-reading.ts`, `guard/fixed-index-read/`

**Check the stop reason before extracting or parsing, and refuse a truncated reply even when its text would parse.**
Why: a cut-off reply is a budget failure, and parsing it first blames the parser or the prompt. → `reference/reading-responses.md`

**Map every stop reason by name, keep an unknown one verbatim, and retry only a pause, never through a continuation loop.**
Why: a new value mapped to the nearest name is hidden, and a loop spends a cap nobody approved. → `reference/reading-responses.md`, `reference/api-facts.md`

**Classify and name every failure, and carry no model text in any of them.**
Why: one generic failure sends every investigation to the same wrong layer, and a failure is what gets reported. → `reference/reading-responses.md`

**Parse the whole text strictly; rescue only a wrapper shape you have measured, and count each rescue.**
Why: a tolerant extractor turns a reply that stopped obeying into a silent success; a measured exception is the method, not a loosening. → `reference/reading-responses.md`

**A reply carrying tool or search blocks gets its own reader; count billed searches from the usage fields; a tool result that is an error object is an error; the tool version is a decision.**
Why: tool blocks sit between text blocks, a block count miscounts retries, an error read as empty looks like "found nothing", and a newer version changes what reaches the reader. → `reference/reading-responses.md`

### Requests, budgets and model swaps

**Thinking tokens count against `max_tokens`: size each ceiling per model by a rule over logged output tokens.**
Why: a ceiling sized for a model that never thinks truncates the day thinking uses it. → `reference/requests-and-models.md`

**Build request parameters per model, and keep a byte-identical comparison of the bodies for models you did not touch.**
Why: one model rejects a parameter another requires, and a change for one model that leaks into another is silent there. → `reference/requests-and-models.md`

**A model swap is a code change first, with test mocks migrated to every envelope shape in the same change, verified by repeated draws against the real model.**
Why: old mocks keep the suite green through the break, and one smoke call can come back clean while one request in several fails. → `reference/requests-and-models.md`, `runner/draw-runner.ts`

**A change to the request body needs one live call.**
Why: an unsupported parameter, a prefilled assistant turn or a wrong model id fails every request while tests that stub the HTTP call stay green. → `reference/requests-and-models.md`

**A prompt defect is a distribution: settle it by N draws, never by one draw or by reading.**
Why: model error and validator discard are rates, and one draw answers a different question. → `reference/requests-and-models.md`, `runner/draw-runner.ts`

### Logging and spend

**One log row per call: outcome, stop reason, tokens, model, effort, thinking-block count, prompt version and origin marker.**
Why: every later question is answerable only from a field recorded at call time. → `reference/spend-and-logging.md`

**A prompt version per prompt kind, not one shared constant.**
Why: a shared version moves for every kind at once and can no longer say which text produced which output. → `reference/spend-and-logging.md`

**The rate limit runs before any paid call, and a cache hit sits above it.**
Why: a limit after the call has already spent, and a cache hit must not consume budget. → `reference/spend-and-logging.md`

**Before any paid run: a dry-run worst case and hard caps on requests and dollars, checked before each call from the usage fields; a search request's worst case includes the injected result tokens.**
Why: only a gate that adds the next call's worst case before sending it holds, and search results are billed as input. → `reference/spend-and-logging.md`, `runner/draw-runner.ts`

**A paid harness records everything the run returned that a later question could need.**
Why: a field nobody recorded can only be recovered by paying again. → `reference/spend-and-logging.md`, `runner/draw-runner.ts`

### Prompt inputs

**Never relay client-authored prompt or instruction text; build the prompt server-side and ignore the old field rather than rejecting it.**
Why: prose cannot be validated, and rejecting a stale field breaks every client still sending it. → `reference/prompt-inputs.md`

**Untrusted text goes in once, in a delimited container; deny-list checks on your own wording run in tests, not at runtime.**
Why: one mention bounds what a hostile value reaches, and a runtime deny-list refuses legitimate input. → `reference/prompt-inputs.md`

**Name every output convention the reader depends on in the prompt, and put the user's local date in it, never the server's.**
Why: an unstated convention is a coin flip per call, and the server's date is wrong for part of every day. → `reference/prompt-inputs.md`

**Assert the rendered prompt, not the downstream output.**
Why: a correct-looking answer is not evidence the prompt carried the value. → `reference/prompt-inputs.md`

**Send per-session flags on every turn, derive an output schema from the validator, and never let a model grade its own output.**
Why: a dropped flag changes the cached prefix, a second schema drifts, and self-report is not evidence. → `reference/prompt-inputs.md`

## Response helpers

`helpers/message-reading.ts` is copyable TypeScript for the Anthropic Messages response shape; other providers are out of scope. It imports nothing, so it runs unchanged under Node, Deno and a browser bundle. Copy it next to the code that calls the API (for a Supabase project, `supabase/functions/_shared/`) and fill `{{DEV_TOOLS_SHA}}` with the short HEAD of this dev-tools checkout.

- `trailingText(message)`: the text of the trailing run of text blocks, or null when the reply ends in a non-text block or has none.
- `classifyStop(stopReason)`: every documented stop reason mapped by name; null or unknown is `unexpected_stop`, carrying the raw value; only `paused` is retryable.
- `parseJsonReply(message, { stripOneFence? })`: the stop reason first (only `end_turn` proceeds, so a truncated reply is refused even if it would parse), then the block types (any tool, server-tool or unknown block refuses with `tool_blocks`), then `JSON.parse` over the whole trailing text. The opt-in strips exactly one fence around the whole reply and reports `rescue: "fence"`. Every failure carries its kind, the raw stop reason, the block types and the text's length, and never any model text.

## Guard

`guard/fixed-index-read/` is an invariant ratchet on the dev-tools `ratchet-tests` core: zero fixed-position reads of a response's content array is the rule, so there is no worklist. Its walker is an AST walk, so a mention in a comment, a string or a regex is never a site and real code beside a comment always is.

- Flagged: `x.content[0]`, `x?.content?.[1]`, `x["content"][0]`, a bare `content[0]`, `content.at(0)` and `.at(-1)`, and any destructured position (`const [first] = x.content`, `{ content: [first] }`, the same in a parameter or an assignment). Compliant: a computed position (`content[i]`) and a call to a configured reader. Sites are keyed (file, enclosing symbol, name, ordinal), never by line.
- Exemptions are a named list of keyed entries, status `EXEMPT`, each with a justification: for a `content` array that is not a response's (a request body's message content), or a read frozen as evidence. A violation with no exemption fails (a); an exemption whose site is now compliant (b) or gone (c) fails as stale; one without a reason fails (d).
- It fails on its own failure: zero files walked or zero sites (g), any file it cannot parse or root that does not exist, by name (h), and a declared shape with no sites (i). The guard test also asserts that the configured reader really skips a leading thinking block.
- Its header records what it cannot see: an array under another name, a read inside a helper, `.find()` for the first text block, and test files.

### Install

Prerequisites: the dev-tools `ratchet-tests` skill's `reference/ratchet-core.ts` (and its prerequisites: Node 22.18 or later, vitest, `@typescript/typescript6`), and the response helpers copied into the project.

1. Copy `skills/ratchet-tests/reference/ratchet-core.ts` to `src/test/ratchets/` if it is not there. Do not copy this skill's `guard/ratchet-core.ts`: it is a one-line re-export that exists only so the guard resolves the core in this checkout.
2. Copy `walker.ts` and `fixed-index-read.test.ts` from `guard/fixed-index-read/` to `src/test/ratchets/fixed-index-read/`, and fill `{{DEV_TOOLS_SHA}}`.
3. Review `CONFIG` in `walker.ts`: `root` assumes this layout; `roots` (the directories that call the API), `exclude`, `arrays`, `readers`, and `readerModule` (where the helpers were copied).
4. Run `npx vitest run src/test/ratchets/fixed-index-read/` in the foreground and read its exit code. Fix each (a) by reading through `trailingText` or `parseJsonReply`; exempt only a read that is not of a response, with its reason. If (i) fails on `computed_index` because the project has such a read, change it to `"required"`. Then raise `MIN_SITES` toward the real site count.
5. Prove it: copy a file the walker reads, append `export const probeRead = (res: { content: Array<{ text?: string }> }) => res.content[0].text;`, and re-run step 4's command. It must exit 1 with a rule (a) failure naming `probeRead :: content :: 0`. Restore the file from the copy, confirm with `diff` that nothing differs, and re-run green.

## Draw runner

`runner/draw-runner.ts` is a copyable TypeScript script that sends one request shape N times to a real model and counts what comes back. Use it for any question whose answer is a distribution: verifying a model swap, settling a prompt defect, or measuring how often a reply arrives as `[thinking, text]`. Anthropic Messages API only. It classifies each reply with the response helpers above and has no reader of its own.

- `--dry` makes no network call and reads no key. It builds every request, checks each, and prints the worst case: draws x (estimated input tokens + `max_tokens`) at the configured prices, plus, for a request carrying a web search tool, `max_uses` x (the search fee + an injected-input allowance, default 10,000 tokens per permitted search) and a tool-prompt allowance. The input figure is an estimate (the serialized body's length over 2.5 characters per token, chosen to over-count), and the output says so.
- `--live` checks before every call that the request cap is not reached and that dollars spent so far, read from the usage fields, plus the next call's worst case stay under the dollar cap, and names the cap that stopped it. A call with an unknown outcome is charged its worst case. There are no retries and no continuation: a failed or paused draw is a recorded data point, and a rejected request (400, 401, 403, 404, 413) stops the run.
- Each draw appends one JSONL record: the raw content blocks (thinking included), usage, stop reason, latency, requested and returned model, a SHA-256 of the request body, the helpers' classification and its cost. The closing summary counts draws by stop reason, by block-shape sequence and by parse outcome, and reports tokens and dollars against each cap. It is written beside the JSONL file as well as printed.
- The API key comes from the environment variable named in config. Live mode refuses to start without it, and the key never appears in a log line, record or summary.
- There are no default prices. The input, output and per-search prices, the date they were read and their source are all required, and a missing one refuses to run. A request carrying `cache_control` also needs the cache prices.
- Optional parity: given the shipping builder's body, the run refuses unless the probe body equals it in every field except the model id. When the builder applies per-model parameters, pass the shipping builder's output for the probe's own model, so parity proves the probe did not re-model by spreading over a built body.

### Copy and configure

1. Copy `runner/draw-runner.ts` to the project (for example `scripts/probes/`), fill `{{DEV_TOOLS_SHA}}`, and point its helpers import at the project's copy of `message-reading.ts`.
2. Fill `CONFIG`: the model id; the draw count, request cap and dollar cap; the prices from the provider's pricing page with the date read and the source; the key's environment variable; an output path that does not exist yet; `buildRequest`, through the shipping builder with the model passed through the builder's own parameter; optionally `shippingBody`; and `parse` (`"json"`, `"json-fence"`, or `"text"` for a search reply or prose).
3. Run `node scripts/probes/<file>.ts --dry` (Node 22.18 or later) and read the worst case before approving the spend.

It is proven against a mocked transport only, never against the real API. So a project's first real run is a dry run, then one draw under a small cap (`draws: 1`, `maxRequests: 1`, a dollar cap just above that draw's worst case), with its record read before any larger run. Before any new draw, replay what earlier records already answer: they hold the raw blocks, so a different reader can run over them at no cost.

## Harness

All three harnesses run under `npm test` in a dev-tools checkout (`npm install` first). None makes a request to any model API; every envelope is written by hand.

- `helpers/test/`: the reader on `[text]`, `[thinking, text]`, `[redacted_thinking, text]`, `[thinking]` alone at `max_tokens`, several trailing text blocks, text-thinking-text and an interleaved search reply; every documented stop reason, null and an unknown one; a truncated reply whose text would parse; the fence opt-in on and off, and every wrapper it must still refuse; and a sentinel planted in the model text, asserted absent from every serialized failure. Break probes, each changing the result and then restored from a copy and confirmed by `diff`: reading `content[0].text`, moving the stop check after the parse, copying model text into a failure, and removing the tool-block check.
- `guard/test/`: every flagged form and what must not be flagged; comments, strings, templates and regexes, with positive controls that real code beside a comment is still flagged; reader calls; keys and ordinals; a walk over a throwaway tree (exclusions, an empty root, a missing root, an unparseable file); the verdict through the core (a violation, a comment-only mention, an exempt site, both kinds of stale exemption, a missing reason, zero files); and the shipped helper run through the guard. Break probes: reading comment text as code, narrowing the pattern to plain `content[0]`, and letting a stale exemption pass in the core.
- `runner/test/`: an injected transport scripted per test. Dry mode never calls it; missing or zero prices, a missing read date and the shipped `CONFIG` refuse; the dollar cap stops before a call whose worst case would cross it, with fixture usage that would cross it after the call; spend comes from usage, and an unknown outcome is charged its worst case; the request cap stops; the search allowance is in the worst case, and a search tool without `max_uses` refuses; parity refuses a second differing field and accepts a model-only difference; the record keeps raw thinking and text blocks; failed and paused draws are recorded without a retry, and a rejected request stops the run; a sentinel planted as the key appears in no log, record or summary; the summary counts block shapes, stop reasons and parse outcomes. Break probes: moving the cap check after the call, letting dry mode call the transport, dropping the raw blocks from the record, and making parity compare nothing.

## Reference files

Open these from this folder when needed:

- `reference/reading-responses.md`: the trailing run, stop reasons, naming failures, strict parsing and measured rescues, tool and search replies. Open before writing any code that reads a model's reply.
- `reference/requests-and-models.md`: thinking budgets, per-model request parameters, model swaps, live calls for body changes, prompt defects as distributions. Open before changing a request body, a ceiling or a model.
- `reference/spend-and-logging.md`: the per-call log row, prompt versions, the rate limit's place, caps and dry runs, what a paid harness records. Open before logging model calls or running anything that spends; `runner/draw-runner.ts` implements its caps, dry run and record.
- `reference/prompt-inputs.md`: server-built prompts, untrusted text, output conventions, local dates, asserting the rendered prompt, cached prefixes, schemas, self-grading. Open before building a prompt from user or stored input.
- `reference/api-facts.md`: dated facts about stop reasons, block types, thinking parameters per model and server tools, each with its source. Re-read the docs before relying on any of them.
