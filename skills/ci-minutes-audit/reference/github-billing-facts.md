# GitHub Actions billing and API facts

**Rule: re-verify live before relying on any fact here.** GitHub pricing, quotas and API behavior change. Every line below was checked on the date shown and can be stale; open the source URL and confirm before you put a number in front of anyone.

URLs:
- [B] https://docs.github.com/en/billing/managing-billing-for-your-products/about-billing-for-github-actions (older path; redirects to the current billing page)
- [P] https://docs.github.com/en/billing/reference/actions-runner-pricing
- [S] https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
- [E] https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
- [L] https://docs.github.com/en/actions/reference/limits
- [R] https://docs.github.com/en/rest/actions/workflow-runs
- [U] https://docs.github.com/en/rest/billing/usage
- [A] https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps

## Quota and rounding

- Included minutes for private repos: 2,000 Free, 3,000 Pro, 3,000 Team, per month; verified 2026-09-28. Source: [B].
- The quota is per account, so it is shared by all of that account's private repos and another repo can use up the pool. The page says: "For private repositories, each GitHub account receives a quota of free minutes, artifact storage, and cache storage for use with GitHub-hosted runners, depending on the account's plan"; "Minutes usage is charged to the repository owner, not the person who triggered the workflow runs"; "the minutes used by the account are reset to zero" each month; private-repo minutes "are consumed from your account or organization's existing plan entitlement". Cache storage is the exception: its included 10 GB is stated per repository. Verified 2026-09-28. Source: [B]; wording read from the docs' own source file (github/docs, content/billing/concepts/product-billing/github-actions.md) as well as the rendered page. The page never uses the word "pooled"; the shared-pool reading follows from the quota being granted per account and charged to the repository owner.
- Public repos are free on standard GitHub-hosted runners; verified 2026-09-28. Source: [B].
- Each job's time rounds up to a whole minute (a 7-second job bills 1 minute); verified 2026-09-28. Source: [P] (the main billing page does not say it).
- The docs now express per-OS dollar rates (Linux 2-core $0.006/min, Windows 2-core $0.010, macOS $0.062) rather than minute multipliers; verified 2026-09-28. Source: [P].
- Minutes reset at the start of each billing cycle; verified 2026-09-28. Source: [B].
- Without a valid payment method, usage is blocked once the quota is used up; verified 2026-09-28. Source: [B].

## Timeouts

- `jobs.<id>.timeout-minutes` defaults to 360; verified 2026-09-28 (read from the docs' own source, since the rendered page fetched truncated). Source: [S].
- A job can run for at most 6 hours; verified 2026-09-28. Source: [L].

## Triggers and notifications

- `paths-ignore` on a push evaluates one two-dot diff between the before and after SHAs, so a multi-commit push is skipped only if the whole push touched ignored paths; verified 2026-09-28. Source: [E].
- A push of more than 1,000 commits always runs the workflow; a diff over 3,000 files with the matching files outside the first 3,000 does not run it; verified 2026-09-28. Source: [E].
- Path filters apply to `push` and `pull_request` only, not `schedule` or `workflow_dispatch`; `paths` and `paths-ignore` cannot be used together for one event; verified 2026-09-28. Source: [E].
- Failure notifications for scheduled workflows go to the user who last modified the cron syntax in the workflow file, so editing a cron line transfers the alerts; verified 2026-09-28. Source: [E].
- Scheduled workflows run only from the default branch, can be delayed at the start of every hour (use a non-round minute), and the shortest interval is 5 minutes; verified 2026-09-28. Source: [E].

## API behavior

- Listing workflow runs needs `actions: read`; naming any permission in a `permissions:` block sets every unnamed one to `none`, so name `contents: read` too if the job checks out code; verified 2026-09-28. Source: [A] and [S].
- The run-timing endpoint (`GET /repos/{o}/{r}/actions/runs/{id}/timing`) is documented as closing down and returned 0 ms for every job in the audit; do not use it as a cross-check; verified 2026-09-28. Source: [R].
- The account billing-usage endpoint (`/users/{user}/settings/billing/usage`) returned HTTP 404 until the `gh` token had the `user` scope (`gh auth refresh -h github.com -s user`); verified 2026-09-28. Source: [U].
- A billing-blocked run shows conclusion `failure` with zero steps and no runner, plus a check-run annotation about failed payments or a spending limit; the jobs endpoint alone cannot tell it from an ordinary failure, so read the annotation; verified 2026-09-28 by observation on a private repo (no docs page describes it).
