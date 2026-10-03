# Product usage and platform metrics

Reading what a product-usage tool or a hosting platform reports: which signals are noise, which split points where, and which number is the authoritative one.

---

## Product usage

**Suppress rageclicks on controls people press repeatedly (quantity steppers, next-page buttons, calendar arrows) by selector, and leave autocapture and rageclick detection on everywhere else.**
Why: most rageclicks in one sample landed on working repeat-press controls, and that noise buries the few that mark a real stuck control.

- Confirm the control works first. Suppress only a control whose repeated presses are the intended use (raising an item quantity to 12 takes 11 taps), never one that might be stuck.
- Match on a stable attribute such as the control's `aria-label`, not on a styling class that a redesign renames.
- In posthog-js the per-element mechanism is `rageclick: { css_selector_ignorelist: [...] }`. Setting the list REPLACES the library's default, which is `['.ph-no-rageclick', '.ph-no-capture']`, so re-add both or every element already marked with those classes starts firing. Recent `defaults` config versions also exclude stepper controls on their own; check what the installed version does before adding to the list.
- Pin the list with a source-contract test, so a config refactor cannot drop it silently.
- Dropping autocapture to silence the noise throws away every other click signal along with it.

**A failure that splits 100% / 0% by account points at the client environment, not the code path; check the account population before bisecting commits.**
Why: identical code failed for every account on one browser engine and for none elsewhere, for weeks, and no commit in the history was the cause.

- A binary account-level split, rather than a gradual failure rate, means browser engine, OS, app version or device. Group the failing accounts by those first.
- Prefer a feature probe at runtime (does this browser encode this format?) over a user-agent check when shipping the fix.

## Platform metrics

**Read CPU and memory from the platform's own shutdown or termination record, never from a wall-clock or in-process proxy.**
Why: a sum of stage timers leaves out the work between and around its spans, and an in-process memory reading can report zero or only the heap, far below what the platform counts against the limit.

- On Supabase Edge Functions the record is the `shutdown` event in the function logs, carrying `cpu_time_used` and `memory_used`. Its reason `EarlyDrop` is the runtime's ordinary idle drop, not a limit event.
- One record covers an isolate's whole life, which can span many requests. Divide by the requests it served before comparing against a per-request limit.
- Stage timers (`performance.now()`) are fine for ranking stages against each other, not for judging headroom against the limit.
- A shutdown record is written when the isolate is dropped, so a function deleted right after a test may never write one. Keep it deployed until the records arrive.
