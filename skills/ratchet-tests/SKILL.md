---
name: ratchet-tests
description: Use when a bug class recurs and can be found by its shape in source; when running a burn-down campaign that needs a count CI keeps honest; or when a guard must fail in the diff that introduces the problem rather than later. Ships a generic ratchet core and a ready-to-adopt fixture-date ratchet.
---

# Ratchet tests

A ratchet test enumerates every site of one pattern from source, gives each a compliant or violation verdict, and holds the violations to a checked-in snapshot. New violations fail, fixed and vanished entries fail, and the snapshot can only shrink toward zero. This skill holds the rules for building one, a generic core that checks them, one shipped ratchet, and two recipes.

## When to build one, and when not

Build one when a bug class has recurred at least once and its sites can be recognised by shape (a call, a key, an import) without running the code. Build one for a burn-down campaign, so the remaining count is a number CI enforces. Build one when a guard must fail in the diff that introduces the problem.

Do not build one for a pattern that only execution can recognise, a one-off fix with no second site, or a rule a type or lint rule already enforces.

**The enumeration is the denominator, never a hand count.**
Why: an audit's arithmetic is true on the day it was done, and an enumeration recounts on every run.

**Prefer a ratchet that fails in the introducing diff over a periodic leg such as a nightly clock-shifted run.**
Why: the periodic leg finds the same sites months later, on someone else's push, with the failure pointing at an innocent commit.

## Three kinds, and a fourth elsewhere

- **Worklist ratchet**: violations exist today. The snapshot lists them with a worklist status, the count burns down to zero, and the status is then retired. The shipped fixture-date ratchet and recipe (a) are this kind.
- **Invariant ratchet**: zero violations is the rule from day one, so there is no snapshot, only the enumeration, the verdict and the self-failure checks. Recipe (b) is this kind.
- **Pins**: one assertion over one fact in source, with no enumeration. See Pins below.
- **Doc contracts** are the fourth sibling: the same idea over documents, in the dev-tools `doc-system` skill. They are not repeated here.

## Core rules

`reference/ratchet-core.ts` checks the generic rules and names each failure by rule letter (a) to (j). Its header carries the same rules with their reasons.

**The test never writes its snapshot; regeneration is a separate script whose diff is read.**
Why: a test that rewrites the file it asserts against absorbs every new violation silently, which is a log, not a ratchet.

**The ratchet runs in both directions: a violation with no entry fails (a), an entry whose site is now compliant fails (b), and an entry whose site is gone fails (c).**
Why: (a) stops the list understating the problem, and (b) and (c) stop it padding the count nobody can then trust.

**Key every site by a structured tuple (file, enclosing symbol, the pattern's own name, ordinal), never by a line number (j).**
Why: a line number moves on every unrelated edit above it, which turns the ratchet into noise.

**Compliance is an exact list of shapes, and any helper on that list is asserted, in its own source, to really do the job.**
Why: a helper list nobody checks decays into a rubber stamp that blesses whatever is added to it.

**A registry of sites compliant by a rule the walker cannot infer is earned, never asserted, and the scan is pinned to exactly its registered sites.**
Why: recognition by name lets a same-named impostor in, and the exact pin turns any widening into a loud failure instead of a silent blessing.

**The guard fails on its own failure: zero enumerated sites or zero files walked (g), any file it cannot parse, by name (h), and any declared shape with no sites unless declared absent with a reason (i); absent declarations are checked both ways, so a shape declared absent that has a site also fails (i).**
Why: a walker that finds nothing and a repo with nothing wrong must never be indistinguishable, and a declaration is an entry; it goes stale like one.

**Prove the walker on synthetic sources, including what it must NOT flag.**
Why: a guard built on a walker passes vacuously if the walker silently stops matching, and an over-broad one buries the real sites in false ones.

**Mutate the guard and watch its own tests go red, in both directions: blind it once, widen it once.**
Why: a check that passes against its own poison is a statement about the check, not the code.

**Walk the AST, never grep.**
Why: a grep cannot see scope, keys or data flow, and it fires on comments and strings, so its only remedy is deleting the explanation.

**Record every exclusion as a decision in the walker's header, with what it leaves out and the denominator it does cover.**
Why: an unrecorded exclusion reads as coverage to every later reader.

**Statuses: a worklist status needs no justification (d), an exempt status requires one (d), a derived status is computed from source and never claimed by an entry (f), and the worklist status is retired at zero, after which an entry carrying it fails by name (e).**
Why: rubber-stamped justifications on a worklist are worse than none; a claimed status outlives its fact; an emptied worklist category left standing invites new debt to be parked in it.

**Pin any mirror of a dependency's internals (a regex, a constant, a file layout) byte-for-byte against the installed source.**
Why: a new release that changes the original silently desynchronises the copy, and the pin turns that into a failure.

**Never spell the detected thing as a literal inside the guard; assemble it from pieces.**
Why: the guard is source too, and a tool that scans whole files for the literal will act on the guard's own copy.

**Loosening a stop condition (a new compliance shape, a wider registry, a relaxed pattern) is a decision for the strongest model available, recorded with who made it.**
Why: a too-loose rule's error is invisible to fixtures written by the same model that wrote the rule.

## Pins

**Pin a constant mirrored across a boundary with an equality assertion over both sources.**
Why: a return window of 30 days in the client and 30 in the server function agree until one side changes alone. Read both files, parse each value, assert they are equal.

**Bound a source contract to the region it means, never the whole handler.**
Why: "the refund branch of the order handler adds no catch", asserted as `not.toContain("catch")` over the whole handler, is only accidentally equivalent to its meaning, and fails on correct code the day a second branch legitimately adds one. Slice from the refund call to its guard and assert on that slice.

**Word-boundary an assertion on a key.**
Why: `p_order_id:` contains `order_id:`, so a plain `not.toContain("order_id:")` fails on correct code. Use a JS regex: `/\border_id:/`.

## The shipped ratchet: fixture-date anchoring

A fixture carrying a literal date that the code compares against a cutoff computed from now is a test with an expiry date: it passes for months, then fails on a commit that never touched it. `reference/fixture-date-anchoring/` guards it.

It checks every object-literal property whose key matches `CONFIG.temporalKey` in `walker.ts` (`_at`, `_date`, `_on`, and bare `date`, `since`, `until`, `cutoff`) under the test roots, TS and JSON alike, skipping golden files. A site is a violation when its value is a date-shaped string, a template literal with a date-shaped head (`YYYY-MM` is enough), or a literal date built by a constructor: `new Date(<date-shaped literal>)`, `Date.parse(<same>)`, `new Date(<two or more numeric literals>)`, `Date.UTC(<numeric literals>)`, or a method called on one of them. Compliant shapes: `anchored` (a `daysAgo`/`dateDaysAgo` call), `computed` (any other expression, including `new Date()`, `new Date(Date.now() - n)`, `new Date(daysAgo(3))`), and `not_date_shaped`.

Statuses:
- `KNOWN_OPEN`: worklist, target zero, no justification.
- `FIXED_BY_DESIGN`: exempt, literal forever, requires a justification.
- `CLOCK_PINNED`: derived. A file that calls `setSystemTime` or `useFakeTimers` derives it for its violations, which then need no entry.

The fix is `clock.ts`: `daysAgo(n)` and `dateDaysAgo(n)` with a literal `n` at every call site. When a test injects a pinned clock into the code under test, anchor both ends or neither.

Limitations, recorded in the walker's header:
- A literal returned from a helper or held in a variable (`created_at: OLD`) reads as computed and is invisible.
- `new Date(<one numeric literal>)` is an epoch, ambiguous between a sentinel and a fixture date, and is not flagged.
- It is a shape rule, not proof that a field meets a rolling cutoff, so it errs toward flagging; `FIXED_BY_DESIGN` is for the literal that is meant.
- A new site inserted above a sibling with the same file, symbol and key shifts the siblings' ordinals, so the failure can name the neighbour's literal. The count is right; regenerate and read the diff.

**When a suite turns red on dates, check out the last green commit and run the failing files against today's clock; if they fail there too, the fixtures expired and no intervening commit is the cause.**
Why: drift and regression look identical in CI output, and this separates them in one run instead of a bisect.

**To seed the worklist in a project that already has drift, enumerate by execution once: shift `Date.now()` and `new Date()` forward by a fixed offset in an extra `setupFiles` entry and run the whole suite, using an offset rather than fake timers.**
Why: only execution shows which literals sit on a cutoff, and frozen time stops wall-clock budget logic from ever running out.

## Install

Prerequisites: Node 22.18 or later, so `node` runs the `.ts` regen script directly; vitest; and a project whose tests under `src/test` already carry temporal fixtures. With none, the walker finds zero sites, regen refuses to seed, and there is nothing to guard yet.

The walker imports the compiler's JS API from `@typescript/typescript6`, Microsoft's side-by-side TypeScript 6 build. TypeScript 7.0 ships no JS compiler API; a stable one is expected in 7.1, and the walker will need porting to it then. A project that already uses Microsoft's alias layout (`"typescript": "npm:@typescript/typescript6@^6"` in `devDependencies`, with TypeScript 7 under another name) skips that package in step 1 and changes the walker's import to `"typescript"`. The walker throws by name if the import has no compiler API.

From this skill's folder (`skills/ratchet-tests/` in the dev-tools checkout):

1. `npm i -D vitest @typescript/typescript6`
2. `mkdir -p src/test/ratchets/fixture-date-anchoring src/test/helpers`
3. Copy `reference/ratchet-core.ts` to `src/test/ratchets/`.
4. Copy `walker.ts`, `fixture-date-anchoring.test.ts` and `regen.ts` from `reference/fixture-date-anchoring/` to `src/test/ratchets/fixture-date-anchoring/`. Do not copy `example-snapshot.json`.
5. Copy `reference/fixture-date-anchoring/clock.ts` to `src/test/helpers/clock.ts`.
6. Replace `{{DEV_TOOLS_SHA}}` in the copied files with the dev-tools short HEAD (`git -C <dev-tools> rev-parse --short HEAD`).
7. Review `CONFIG` in `walker.ts`: `root` assumes this layout; also `testRoots`, the `exclude` globs for golden files, and `temporalKey` (add `(At|Date|On)$` for camelCase keys). Keep `TEMPORAL_KEYS` in the test in step with it.
8. `npm pkg set scripts.regen:fixture-dates="node src/test/ratchets/fixture-date-anchoring/regen.ts"`
9. `npm run regen:fixture-dates` to seed `snapshot.json`, and read the summary.
10. Run `npx vitest run src/test/ratchets/fixture-date-anchoring/` in the foreground and read its exit code. If rule (i) fails on a shape the project genuinely lacks (on first adoption `anchored` usually has no sites, since `clock.ts` is new), declare it `{ absent: "<reason>" }` in `SHAPES` in the test and re-run; the ratchet will fail and tell you when an absent shape gains a site. Then raise `MIN_SITES` toward the real site count. If the project's default vitest environment is a DOM one, add `// @vitest-environment node` as the test's first line.
11. If the project typechecks with `tsc`, its tsconfig needs `allowImportingTsExtensions` with `noEmit`, since the copied files import each other by `.ts` path.
12. Prove it: copy an existing test file that the walker reads, append `export const probeOrder = { created_at: new Date("2000-01-02") };` to it, and run step 10's command. It must exit 1 with a rule (a) failure naming `probeOrder :: created_at`. Restore the file from the copy, confirm with `diff` that nothing differs, and re-run step 10's command green.

Burn-down: anchor a fixture with `daysAgo()`/`dateDaysAgo()`, delete its entry, stay green.

## Recipes

Patterns only; no code ships for these. Build each on `reference/ratchet-core.ts` and copy `reference/regen-template.ts` for the regen script.

### (a) Unchecked-result ratchet (worklist)

For any client whose calls return a result-plus-error value instead of throwing, where a call that never reads its error fails silently.

- Enumerate every call chain of the client, keyed by (file, enclosing symbol, target name, ordinal).
- Compliance shapes, exactly: the chain or its settled result is handed to a designated error-reading helper; the error is destructured AND referenced afterwards in the same scope; or the chain opts into throw-on-error. Destructured but never referenced is not compliant: it reads as handled while checking nothing.
- Assert each designated helper reads the error in its own source.
- An injected reader, where the chain crosses a function boundary and the error is read on the other side, is compliant only through a registry, never by inference: "returned" or "passed as an argument" alone looks exactly like an unchecked site handing its result to a caller that ignores it. Register a callback slot as (callee, property, consumer file) and a producer as (function name, declaring file). Prove each: the consumer invokes the slot and reads the error, and every caller of a producer checks its result. Pin the scan to exactly the registered sites, and negatively probe an unregistered callee, a wrong property, a wrong-file producer and an ignored argument.
- Record exclusions as decisions: a sibling API on the same client whose results do not share one shape needs its own analysis, and operator-run scripts fail in the operator's terminal.
- Retire the worklist status at zero; the exempt status stays, with a justification per entry.

For the Postgres-client instance of this, and why a returned error makes a `try`/`catch` a false gate, see the dev-tools `supabase-hardening` skill.

### (b) Environment-split invariant ratchet (vitest)

For a suite where `node` is the default environment and jsdom is opt-in, the silent failure is a node test importing a module that branches on the environment: it passes by taking the other branch.

- Enumerate the non-test modules that branch on the environment (`typeof window`, `typeof document`, `typeof navigator` and the like), excluding the configured setup files.
- For every test that resolves to node, count runtime imports: static, re-export, dynamic `import()`, `require` and `vi.importActual`. Do not count `vi.mock` with a factory, which replaces the module, or type-only imports.
- Copy vitest's directive regex into the guard and pin the copy against the installed vitest source.
- Assert the config has no root `include`: `extends: true` concatenates arrays, so every file would run once per environment.
- Never write the directive as one literal in the guard; vitest scans the whole file for it.
- Direct imports only; say so in the header, and let execution be the backstop for transitive ones.
- Non-vacuity floors: the sensing set is non-empty, the node set contains the guard itself, and at least one opted-in test is seen importing a sensing module.

The config shape and the traps behind each point are in the dev-tools `vitest-suite-speed` skill, `reference/environment-split.md`.

## Documenting a ratchet

Give each ratchet one entry in the project's `CLAUDE.md`, beside the failure pattern it guards, so the next session finds the guard where it reads about the bug:

```markdown
**<The bug class, as a rule>.** (guard: `<test path>`)
- Problem: <what fails, and why nothing else catches it>.
- Enumeration: <what the walker visits, keyed by (<key fields>)>; that count, not any hand count, is the denominator.
- Compliant shapes: <the exact list>; <helpers or registries, and what asserts them>.
- Statuses: <worklist status> (target zero); <exempt status> (justification required); <derived status, if any>; <retired statuses>.
- Scope boundary: <what is excluded, as decisions>; <what it cannot see>.
- Standing count: <n> open at <version>; regenerate with `<regen command>` and read the diff.
```

The standing count is a live number, so stamp it with the version it was read at. For where specs, decisions and live numbers belong, see the dev-tools `doc-system` skill.

## Files

- `reference/ratchet-core.ts`: the generic checker, rules (a) to (j), plus the regen planner. Imports nothing and never writes.
- `reference/regen-template.ts`: the regen script with `PLACEHOLDER` values to fill.
- `reference/fixture-date-anchoring/`: the shipped ratchet: `walker.ts`, `fixture-date-anchoring.test.ts`, `regen.ts`, `clock.ts`, and `example-snapshot.json` (shape only, never copied).
- `reference/test/`: the self-tests, run by `npm test` in the dev-tools checkout.
