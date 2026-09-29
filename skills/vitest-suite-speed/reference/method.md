# Measure-first method

## Read vitest's own phase breakdown

The default reporter's last line reports `transform`, `setup`, `collect`, `tests`, `environment` and `prepare`, plus `Duration`. Each phase is a sum across every worker's own time in it, so the phases add to more than the wall-clock. Phase sum divided by Duration approximates effective parallelism (2.73x on a 4-logical-core laptop in the worked example). Do not expect phases to add up to Duration.

## What per-file duration means

The JSON reporter's per-file `duration` (its `endTime` minus `startTime`) spans only the test-execution window: from that file's first test start to its last test end. It does NOT include the file's environment setup, module collection or queuing. Verified by reading the installed vitest 3.2.4 source: the JSON reporter takes the min test `startTime` and the max test end per file, and a test's `startTime` is stamped when that test begins. Do not use per-file duration to rank overhead; use the phase totals.

## Compare phases, not wall-clock

Two single runs of the same unchanged tree differed by 50 to 60 seconds of wall-clock. A change whose expected saving is smaller than that cannot be confirmed by one before/after wall-clock reading. Compare the phase figures, which move for a reason, and convert a worker-time saving to wall-clock by dividing by the run's own parallelism figure. Run one before/after pair in the same foreground conditions, exit code read directly, and check for leftover vitest workers before every launch (`pgrep -fl vitest`): two concurrent runs contend for the same cores and look like a hang.

## Look for overhead, not slow tests

In the worked example, `environment` plus `collect` together (about 459 s of worker time) exceeded `tests` alone (about 256 s). Per-file overhead (environment instantiation and module collection) accounted for more accumulated time than test execution. The typical culprit is running every file under jsdom when a large share of them touch no DOM. Duration is also concentrated (14 of 254 files were half of summed execution time), but hotspot files are a second lever after the environment.

## Prove a change removed nothing

Run the full suite with `--reporter=default --reporter=json --outputFile=<path>` before and after. Compare per-file passed, failed, skipped and todo counts from the two JSON reports, file by file. The environment split's proof: 287 files in both, 0 differing, and the only new file was the new guard test (its tests account for the whole total-tests delta). A file that exists in one report alone, or any count that differs, is a defect until explained.
