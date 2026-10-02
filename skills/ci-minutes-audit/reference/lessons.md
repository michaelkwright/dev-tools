# Lessons

One per bullet, each with why it matters. Worked numbers are in [`case-study-private-app-2026-09.md`](case-study-private-app-2026-09.md).

- **Measure before changing.** Pre-measurement guesses (docs-only pushes, `cancel-in-progress`, dependency caching) were all wrong: docs-only runs were 0.3% of minutes, and the other two were already configured. The real drivers were a second timezone leg on every push (42%) and per-job rounding (11.4%). Run the analyzer first; a lever chosen from intuition can be a no-op.
- **A tiny decision or setup job bills a full minute on every run.** A 7-second "which path are we on" job costs as much as a 60-second one. Move the decision to workflow-level path filters instead of a job.
- **Fewest jobs per run.** Every job adds its own round-up plus its own checkout and install. One job with several steps beats several small jobs.
- **`timeout-minutes` is a spend cap.** The platform default (360) lets one hung job burn a large share of a monthly pool. Size it from observed durations (about 2x to 6x the worst) and set it on every job.
- **Where a mandatory local full-suite gate exists and CI only reports, per-push CI should be cheap checks and the full suite should be scheduled.** Otherwise CI re-runs, at billed cost, a suite the author already ran.
- **Scheduled skip-if-unchanged must be conservative.** Skip only when the same (commit, leg) already succeeded with the suite actually executed: a run whose gated steps were skipped also concludes `success`, so check the step's own conclusion. Fail open on any API error. A red run is therefore never followed by a skip and keeps re-alerting until fixed.
- **Reporting-only CI needs a pull channel.** Nobody reads the Actions tab: a red run went unread across three versions. Add a session-start check of the latest scheduled result, alongside the failure email, which goes only to whoever last edited the cron line.
- **Before ignoring `.md` paths, grep the build for anything that reads Markdown** (imports, `?raw` loads, fetches, bundlers). If something does, that path must stay out of `paths-ignore`, or a Markdown-only push would skip a build that depends on it.
- **actionlint can be built without sudo:** `GOBIN=<scratch dir> go install github.com/rhysd/actionlint/cmd/actionlint@latest`, then run it on the workflow files. It adds nothing to the repo. Without shellcheck installed its embedded shell checks do not run (`-verbose` says so), so also `bash -n` any script and execute it against real history.
