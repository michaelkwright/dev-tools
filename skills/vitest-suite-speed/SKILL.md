---
name: vitest-suite-speed
description: Use when a vitest suite is slow, or when setting up test infrastructure for a new TypeScript/React project.
---

# Vitest suite speed

Most of a slow vitest suite's time is usually per-file overhead (environment instantiation, module collection, setup), not test bodies. Measure first, then remove that overhead; do not start by rewriting slow tests.

## Method

1. Run the full suite once in the foreground with `--reporter=default --reporter=json --outputFile=<path>`, exit code read directly, and no leftover vitest workers (`pgrep -fl vitest`).
2. Read vitest's phase line: `transform`, `setup`, `collect`, `tests`, `environment`, `prepare`. Phases are summed across workers, so they exceed `Duration`; sum divided by Duration is the effective parallelism.
3. If `environment` plus `collect` rival or beat `tests`, per-file overhead dominates. Compare phase totals, not wall-clock: single runs of an unchanged tree vary by 50 to 60 seconds.
4. After any change, prove nothing was dropped by diffing per-file passed/failed/skipped/todo counts from the before and after JSON reports.

## Default for new projects: the environment split

`node` is the default environment; `.tsx` tests run jsdom by include pattern (via `projects`); a DOM-using `.ts` test opts in with the jsdom environment docblock on its first line. The setup file must follow the environment the file resolved to, and a guard test must fail any node test that directly imports a module that branches on the environment. Set this up when the project starts, before the first hundred tests. The traps (`extends: true` concatenating a root `include`, the docblock not changing `setupFiles`, vitest scanning the whole file for the directive) are in the reference below.

## Reference files

Open these from this folder when needed:

- `reference/method.md`: how to read the phase breakdown, what per-file JSON duration does and does not include, the noise floor, and how to prove a change removed nothing. Open before measuring or interpreting a run.
- `reference/environment-split.md`: the config shape, every trap found, the guard-test design, the classify-by-execution step, and worked results. Open before implementing or reviewing the split.
