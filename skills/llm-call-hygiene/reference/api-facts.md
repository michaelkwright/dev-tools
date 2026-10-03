# API facts that will date

**Re-read the linked docs before relying on any fact below.** Each was read on the date beside it and holds only until the provider changes it. Where a fact here disagrees with a project's own notes, re-read the docs; the docs win. Scope: the Anthropic Messages API.

## Stop reasons

Read 2026-10-02 from https://platform.claude.com/docs/en/api/handling-stop-reasons.

- The documented values are `end_turn`, `max_tokens`, `stop_sequence`, `tool_use`, `pause_turn`, `refusal` and `model_context_window_exceeded`. `helpers/message-reading.ts` maps exactly these; anything else is `unexpected_stop`, kept verbatim.
- `pause_turn` means a server-tool loop reached its iteration limit. The docs say to continue by sending the response back as-is, which is a second billed request.
- `refusal`: the docs say a refusal on the newest models "can usually be served by retrying on another Claude model". That is a fallback to a different model, a decision for the caller, not a retry of the same request; the helper marks it non-retryable.
- `model_context_window_exceeded`: the response filled the model's context window. It is a cut-off reply like `max_tokens`, with a different cause.
- `stop_reason` is null in a streaming `message_start` event and arrives in `message_delta`. A non-streaming response with a null stop reason is unexpected.

## Thinking and `max_tokens`

Read 2026-10-02 from https://platform.claude.com/docs/en/build-with-claude/thinking and https://platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting.

- Thinking tokens are billed as output and count toward `max_tokens` alongside the response text. A long thinking pass can use the whole ceiling, giving `stop_reason: "max_tokens"` with a missing or cut-off text block.
- `usage.output_tokens_details.thinking_tokens` reports how many billed output tokens were thinking (documented on the extended-thinking page, https://platform.claude.com/docs/en/build-with-claude/extended-thinking, read the same day).
- Under adaptive thinking the model decides per request whether to think, so some responses carry a thinking block and some do not. A reader tested on one draw has seen one shape.

## Content block types

Read 2026-10-02 from the thinking page above and https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool.

- Text-only replies carry `text`, `thinking` and `redacted_thinking` blocks. Thinking arrives in `thinking` blocks ahead of the response text.
- `redacted_thinking` is a distinct block type returned when reasoning is safety-redacted: its content is an opaque `data` field with no text. It is separate from `display: "omitted"`, which returns ordinary `thinking` blocks with an empty `thinking` field.
- Client tools add `tool_use` blocks. Server tools add `server_tool_use` and a result block per tool (for web search, `web_search_tool_result`), and a search turn interleaves text, `server_tool_use` and result blocks; citations ride on the text blocks.
- On the newest models, a response that stops on `max_tokens`, `model_context_window_exceeded` or `stop_sequence` soon after a tool call can end in a thinking block standing in for unfinished work. A trailing-text reader correctly returns nothing for it.
- When round-tripping a conversation, send `thinking` and `redacted_thinking` blocks back unchanged; filtering on `type == "thinking"` alone drops the redacted ones and breaks the request.

## Model-specific thinking parameters

Read 2026-10-02 from the troubleshooting page above (its per-model table).

- With no `thinking` field, Claude Opus 5.5, Claude Sonnet 5.5, Claude Fable 5.1 and the other 5-series models run adaptive thinking; Claude Sonnet 4.6, Claude Opus 4.6 and Claude Haiku 4.5 run with thinking off.
- Claude Sonnet 5.5 rejects `thinking: {type: "disabled"}` with a 400 at every effort level. Its lowest setting is `thinking: {type: "between_tools"}`, which turns off up-front thinking: "Without tools, the response contains only text." With tools, the short updates it writes between tool calls come back as `thinking` blocks.
- `between_tools` is accepted only by Claude Sonnet 5.5 and only at effort `high` or below. At `xhigh` or `max` it is a 400, and so is a per-message effort that changes the level in effect. It takes no other field: `display`, `budget_tokens` or `block_binding` sent with it is a 400.
- Every other model rejects `between_tools` with a 400, Claude Sonnet 4.6 included. So a request that sends it has to be built per model.
- `thinking: {type: "enabled", budget_tokens: N}` is a 400 on Claude 4.7 and later, and deprecated on the 4.6 models. Claude Opus 5.5 and Claude Fable 5.1 reject `"disabled"` too: thinking is always on there.
- The thinking configuration and the effort level are part of the cached prompt prefix. Changing either between requests in one conversation drops cache hits.

## Server tools

Read 2026-10-02 from the web search page above.

- An error inside a search is a 200 response whose `web_search_tool_result` has `content` as a single object of type `web_search_tool_result_error`, with an `error_code` (`too_many_requests`, `invalid_tool_input`, `max_uses_exceeded`, `query_too_long`, `request_too_large`, `unavailable`). A search that succeeds with no matches returns an empty `content` list. The two must never be read as the same thing.
- Searches are billed per use from `usage.server_tool_use.web_search_requests`. A search that errors is not billed. Search results are counted as input tokens, in the turn's later iterations and in later turns.
- Three versions are documented: `web_search_20250305`, `web_search_20260209` and `web_search_20260318`. From `web_search_20260209` on, `allowed_callers` defaults to `["code_execution_20260120"]` (dynamic filtering) rather than `["direct"]`, which adds code-execution result blocks and a `caller` field to the response. Moving to a newer version changes the response's shape.
