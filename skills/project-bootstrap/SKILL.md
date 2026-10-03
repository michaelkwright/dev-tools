---
name: project-bootstrap
description: Use to set up the planning → Claude Code workflow in a new repo, or to adopt it into an existing one (including one scaffolded by another tool), or when the user asks to bootstrap a project.
---

# Project bootstrap

Seeds a repo with a `CLAUDE.md`, the doc system and its contract test, a committed permission rule, and the Claude.ai planning instructions. The rules live in the templates and in the doc-system skill; this file only sequences them. "The target" below is the repo being bootstrapped; "dev-tools" is the checkout this skill lives in.

The first planning chat, before this skill runs, can open with [`templates/kickoff-chat.md`](templates/kickoff-chat.md): it settles in conversation the answers step 3 asks for.

## 1. Locate and verify the source

```bash
skill_dir="$(dirname "$(readlink -f <absolute path of this SKILL.md>)")"
dev_tools="$(git -C "$skill_dir" rev-parse --show-toplevel)"
git -C "$dev_tools" fetch --quiet origin
git -C "$dev_tools" status --porcelain                      # must print nothing
default_branch="$(git -C "$dev_tools" symbolic-ref --quiet --short refs/remotes/origin/HEAD || echo origin/main)"
git -C "$dev_tools" merge-base --is-ancestor HEAD "$default_branch"   # must exit 0
git -C "$dev_tools" rev-parse --short HEAD                  # DEV_TOOLS_SHA
```

**Refuse to continue if the checkout is dirty or HEAD is not contained in the remote's default branch; tell the user to commit and push dev-tools first.**
Why: every seeded file records `DEV_TOOLS_SHA`, which must name content anyone can look up.

A checkout pinned to a commit has a detached HEAD and no upstream; that is expected, and it passes as long as the commit is on the default branch.

Read every template from this checkout: `templates/` next to this file, and `skills/doc-system/` (its `SKILL.md`, `templates/`, `reference/`).

## 2. Detect before asking

Read the target and derive every placeholder default from what is there (each template's TEMPLATE NOTES comment lists its placeholders and defaults):

- `package.json`: name, scripts, the test runner, the lockfile's package manager; any `vitest.config.*` or `test` key in `vite.config.*`.
  - `BUILD_CMD`: the build script. `TYPECHECK_CMD`: the typecheck script, else the `tsc` step the build runs (e.g. `npx tsc -b`). `TEST_CMD`: the test script (`npm test`) when it runs the test runner, else the runner directly. A script that only prints an error, like npm's default, is no test command.
  - `TZ_TEST_GREP`: the default grep over every directory that holds source or tests.
- Framework markers (vite, react, phaser): a DOM framework means the report points to the vitest-suite-speed skill for the test-environment split.
- `supabase/` suggests the database and supabase blocks; `supabase/.temp/project-ref` holds a linked ref, which also means the Supabase project exists.
- Scheduled CI: a `.github/workflows/` file with a `schedule:` trigger keeps the `scheduled-ci` block and fills `SCHEDULED_CI_CMD` with that file's name. With none, the block is stripped without asking.
- Strategy docs: a Markdown file whose name or first heading marks it as strategy, positioning or launch plan (`STRATEGY.md`, `docs/launch-plan.md`, say). Only a found doc lets step 3 offer the `strategy` block; with none, it is stripped without asking.
- `LOCAL_TZ`: the system timezone, from `node -p 'Intl.DateTimeFormat().resolvedOptions().timeZone'`, else the zone name in `readlink /etc/localtime`. Step 3 only confirms it.
- Git: whether the target is a repository (`git rev-parse --is-inside-work-tree`), its remotes (`git remote`), and anything already uncommitted (`git status --porcelain`), for step 5f.
- Existing `CLAUDE.md`, `.claude/settings.json`, `.gitignore`, and every doc the doc-system ADOPT inventory names. SEED when none of the doc-system files exist (its seed set; `CLAUDE.md` and a README are not among them); ADOPT otherwise.
- Visibility: `gh repo view --json visibility` when `gh` is available and the remote is on GitHub; otherwise ask.
- The contract-test path: `src/test/doc-contracts.test.ts` by default. Use the repo's test directory if tests live elsewhere. If a tsconfig includes the path without node types, use a top-level `test/` outside every tsconfig instead, since the test imports `node:fs`.

**Already bootstrapped** means every piece exists: `CLAUDE.md` with a `Seeded from dev-tools @` line and the limits markers; the doc system (the seed set, or the files its ADOPT mapping named); the contract test; `.claude/settings.json` with the deny rule if `CLAUDE.md` has a Supabase section; and the `.gitignore` line. If so, skip steps 3 to 6 and change nothing tracked. Run step 5e with the command recorded in `CLAUDE.md`, and report "already bootstrapped from dev-tools @ <recorded SHA> (current: <DEV_TOOLS_SHA>); nothing changed" with the 5e results. Never re-seed or update files the project now owns. If only some pieces exist, do only the missing ones. `.claude/project-instructions.local.md` is untracked, so it is not a piece: when it is missing, or the user asks to regenerate it (once the backend exists, say), offer step 5d alone, asking only the step-3 questions it needs.

## 3. Ask only what detection can't answer, in one batch

**Ask in plain words a first-time user can answer, never in this file's vocabulary (block names, placeholder names, "connector"); the table maps each answer to what it sets.**
Why: a question the user cannot parse gets a guessed answer, and a guess written into the instructions reads as fact to every later session.

| Ask | Sets | Ask only when |
|---|---|---|
| "What's the project called?" (suggest the `package.json` name, else the directory name) | `PROJECT_NAME` | always |
| "In one sentence, what does it do, and for whom?" | `PROJECT_PITCH`, and `PRODUCT_SUMMARY` unless they give a longer one; fill it as a sentence ending in a full stop, since the template runs straight on | always |
| "What will count as launched, and by when?" | `LAUNCH_TARGET`, without a closing full stop (the template adds one), with a relative date made absolute (below) | always |
| "What must be true before launch? (For example: no user can ever see another user's data.)" | `LAUNCH_BLOCKERS`, without a closing full stop | always |
| "Will the app keep its data in a database?" | `database` block (both templates) | always; suggest yes when `supabase/` exists |
| "Will that database be Supabase?" | `supabase` block (both templates) | the answer above is yes |
| "Have you created the Supabase project yet?" | the no-backend path below | Supabase, and no linked ref was found |
| "What's the project's ID? It's the short code after `/project/` in the Supabase dashboard's address." | `SUPABASE_PROJECT_REF` | the project exists and no linked ref was found |
| "Have you signed up in your own app yet? If so, what's your user ID? (Supabase dashboard → Authentication → Users, your row.)" | `OWNER_USER_ID` | the project exists |
| "Have you added Supabase to your Claude.ai Project as connections? If so, what are the names of the one that can only read and the one that can also change data?" | `SUPABASE_RO_CONNECTOR`, `SUPABASE_RW_CONNECTOR` | the project exists |
| "Will the app call an AI model, like Claude, with a paid API key?" | `llm` block | always |
| "I found `<paths>`. Should the planning chat treat them as the project's strategy and launch plan?" | `strategy` block, `STRATEGY_DOC`, `LAUNCH_PLAN_DOC` (delete the line of any doc not found) | step 2 found such a doc |
| "Do you keep dated status reports that you add to the Claude.ai Project? If so, where, and how are they named?" | `digest` block, `DIGEST_PATTERN` | always; most new projects say no |
| "Is there a Claude Code skill holding facts about this project's subject, for the planning chat to read? If so, where?" | `domain-skill` block, `DOMAIN_SKILL_PATH` | always; most new projects say no |
| "Your timezone looks like `<detected>`. Is that right?" | `LOCAL_TZ`; `SECOND_TZ` is Asia/Tokyo, or America/New_York when local is within three hours of Tokyo | always |
| "There's no test command yet, and the doc check this setup installs runs on vitest, a test runner. Add vitest now and make it the test command (`npm test`), or add vitest for the doc check only and set up the test command later?" | the vitest install and `test` script (step 5b); `TEST_CMD` is `npm test`, or on "later" the not-set-up line (below) | no test command was found |
| "The doc check this setup installs runs on vitest, a test runner, and it isn't installed. Add it now?" | the vitest install (step 5b) | a test command exists but vitest does not |
| "There's no `<build / typecheck>` command yet. Add one now, or leave it for later?" | `BUILD_CMD`, `TYPECHECK_CMD`; "later" writes the not-set-up line (below) | per missing command |
| "Will the repo be public (anyone can read it) or private?" | visibility | detection could not tell |
| "What's the smallest first piece you want to build?" | the first `ROADMAP.md` epic (step 5b) | always; "not sure yet" is a fine answer |
| "Save these setup files as a commit when done? (Recommended: yes.)" When step 2 found uncommitted files already there, list them and ask whether the commit includes them too. | step 5f commit | always |
| "Create a `<visibility>` GitHub repo named `<name>`, and upload this commit to it?" (`<name>`: the project name, lowercased, spaces as dashes; the user may change it) | step 5f remote and push | `git remote` lists none, and the commit answer is yes |

The `database` and `supabase` blocks are in both templates, `scheduled-ci` in `CLAUDE.md` only, and `strategy`, `digest`, `llm` and `domain-skill` in the instructions only.

**Never write an invented value: a placeholder the user has not answered and detection has not found is stripped with its block, or written as the environment variable below, never filled with a made-up stand-in.**
Why: a stand-in passes every placeholder check and reads as fact, so later sessions build on an ID that does not exist.

**Declining vitest stops the bootstrap before anything is written.**
Why: the doc check runs on it, and a bootstrap that cannot run its own check cannot say its docs are in shape.

**A command answered "later" replaces its whole code span, backticks and any `TZ=` prefix included, with plain text naming the command and marking it, `the <build / typecheck / test> command (NOT SET UP YET: <what to add>)`, never a runnable default; the report lists each one.**
Why: a default command in `CLAUDE.md` reads as working, so a session runs it and builds on its failure.

Adjust only the words around the replacement, and only as far as grammar needs: "→ one `{{BUILD_CMD}}` →" becomes "→ the build command (NOT SET UP YET: …), once →", and "(`TZ={{LOCAL_TZ}} {{TEST_CMD}}`)" becomes ", the test command (NOT SET UP YET: …),".

**Turn a relative date in any answer ("end of next quarter", "in six weeks") into an absolute date, `Month D, YYYY`, counted from today, and confirm it with the user before writing it.**
Why: a relative date is true only on the day it was said, and every later session reads it against its own today.

**No backend yet: when the database is Supabase but the project does not exist, ask nothing more about it. Keep `CLAUDE.md`'s supabase block (with `$SUPABASE_PROJECT_REF` as below) and the step-5c deny rule; strip the instructions' supabase block.**
Why: the build rules and the deny rule apply from the first migration, while the planning chat's Supabase rules name a project and connections that do not exist yet. The report says "regenerate the Claude.ai instructions after the backend exists".

The instructions' supabase block is kept only when the ref, the owner user ID and both connection names are all real answers; otherwise it is stripped the same way, and the report says what to finish before regenerating.

**If the target is public, or no Supabase project exists yet, no project ref or ID goes into any committed file: write `$SUPABASE_PROJECT_REF` in place of the ref and add a line under that code block saying the ref is kept out of the repo, set it locally. Say so to the user.**
Why: a public repo publishes everything committed to it, forever. A private repo may hold the ref; the report says to swap it out before the repo ever goes public.

## 4. Seed or adopt, never clobbering

**For every target file that already exists, `.gitignore` included, show the proposed merge and apply it only on approval.**
Why: the project's existing notes and settings are its own, and a bootstrap that overwrites them loses work silently.

- Existing `CLAUDE.md` (this skill governs it, not doc-system ADOPT): the filled template, with the old content kept verbatim under a `## Project Notes` section just before `## Known Failure Patterns`; a leading H1 title is dropped, and the proposal says so. Flag any old note that contradicts a template rule, in the proposal and the report, instead of choosing between them.
- Existing docs: the doc-system ADOPT mapping, including the `CONFIG` fit, is part of this proposal, since step 5a needs its values.
- Existing JSON: merged key by key; arrays are unioned; the result must parse.
- Existing `.gitignore`: the merge only appends lines and changes none, and it is shown and approved like any other. It holds the step-5d line, plus `node_modules/` and the build output folder when a commit is wanted and they are missing.
- `package.json` and the lockfile change only through an approved dependency install, or the `test` script the step-3 test answer approved.

## 5. Write, in this order

**ADOPT only, before any other write: install the contract test with its approved `CONFIG` (5b's path, and vitest per step 3), then run its template-token check alone, `npx vitest run <test path> -t "template token"`, in the foreground and unpiped. Every token it reports was already there: list each for the user and offer a `CONFIG.templateTokens.allow` entry for it (file, token, and a reason the user gives), never an edit to their text.**
Why: a token the project wrote is the project's to fix or keep, and one bootstrap cleared silently could be a value someone meant to fill.

A "not found" failure in that run means only a file 5b seeds next. A token whose allowance the user declines keeps 5e red, and the report names it as theirs to fix.

**a. `CLAUDE.md`** from `templates/CLAUDE.md.tmpl`:
- Fill every placeholder. `DOC_CONTRACT_CMD` is `npx vitest run <test path>`. `DOC_CONTRACT_LIMITS` is doc-system's `reference/limits.md` below its rule, filled from the test's `CONFIG` as step 5b will leave it and from `DOC_CONTRACT_CMD`. After an ADOPT fit, also rewrite numbered items 7 and 11 of the limits list to the fitted heading and date shape; the test checks only the numeric phrases.
- Keep or strip each optional block; delete the `BEGIN:`/`END:` marker lines of kept blocks, and stripped blocks entirely. Then, outside code fences, collapse every run of blank lines to one, and every two `---` rules with only blank lines between them to one. Old content an ADOPT keeps verbatim is left as it is.
- Keep the `doc-contract-limits:start`/`end` markers. Delete the TEMPLATE NOTES comment.
- Fail if any `{{` remains outside a code fence, any template placeholder remains anywhere, or any stand-in value appears (checks below).

**b. Docs and the contract test** by following doc-system's `SKILL.md` in the step-2 mode, including its break-and-restore proof, with the step-2 test path and `CONFIG.root` set to reach the repo root from it. Fill `{{DEV_TOOLS_SHA}}` in the test's header comment too. The test stays TypeScript even in a JavaScript repo; vitest runs it without a tsconfig.
- If vitest is absent, add it as a dev dependency with the repo's package manager, as the step-3 answer approved (the latest version compatible with the repo's vite, if any), and the `test` script `vitest run` only if that answer chose it.
- When step 2 found a DOM framework, point to the vitest-suite-speed skill for the test-environment split; do not set it up here.
- When the user named a first piece to build, replace `ROADMAP.md`'s example epic with it, in the same shape: an `##` heading naming it, one line on what it does, and a `### Sequence` of numbered steps (one step is fine). Drop the example's decision-record sentence and its Deferred item, leaving `- Nothing yet.` under Deferred. Otherwise keep the example, and the report says to replace it.
- ADOPT specifics:
  - Add no changelog entry.
  - Stamp the spec with today's date and the top existing entry's version, in the fitted date and version formats.
  - Give the seeded doc-system Feature Index row and subsection the version `adopted after <that version>`.
  - Name the open archive `v<oldest existing version>-onward.md`; archive file names keep the `v` form whatever the heading format.
  - Warn in the report if the fitted entry marker would also match a non-entry heading a later edit might add (an `## Unreleased` section, say).

**c. `.claude/settings.json`**, the shared settings file meant to be committed (not `settings.local.json`). With the supabase block kept, merge in:

```json
{ "permissions": { "deny": ["Bash(supabase db push:*)", "Bash(npx supabase db push:*)"] } }
```

Without that block there is nothing to add; create no file.

**d. The Claude.ai instructions**: fill `templates/claude-ai-project-instructions.md.tmpl` the same way (placeholders, blocks, marker lines, TEMPLATE NOTES, the checks below). Write it to `.claude/project-instructions.local.md`, which is never committed and so may hold the real ref and IDs, and add that exact path to `.gitignore`.

Then ask "Copy the Claude.ai instructions to your clipboard now?". On a yes, copy the file with the platform's clipboard command and read its exit code: macOS `pbcopy < <file>`; Windows, in PowerShell, `Get-Content -Raw -Encoding utf8 <file> | Set-Clipboard` (`clip` garbles non-ASCII text, and this command is untested on Windows); Linux `wl-copy < <file>`, else `xclip -selection clipboard < <file>`, else `xsel --clipboard < <file>`. If no clipboard tool exists, say so and print the file's contents in the session instead.

**The instructions file stays at `.claude/project-instructions.local.md`, and its contents never go into any committed file.**
Why: it may hold the real ref and IDs, and `.claude/` is a hidden folder, so the copy command in the report is how the user gets at it again.

**e. Run the scoped doc-contract command** (`DOC_CONTRACT_CMD`) in the foreground, unpiped, and read its exit code. It must be green. If the repo has a build script, run it once too: the bootstrap is not done if the new files broke it.

Checks, over every Markdown file written or merged (and the test file where named). They run once, and are broader than the doc-contract test's template-token check, which holds the recorded half: on every doc-contract run it fails any unfilled `UPPER_SNAKE_CASE` token in the docs and `CLAUDE.md`, but never sees the instructions file, a lowercase or partial `{{`, or a stand-in.

```bash
awk 'FNR==1{f=0} /^[ \t]*```/{f=!f; next} !f && /\{\{/{print FILENAME":"FNR": "$0; bad=1} END{exit bad}' <files>
grep -nE '\{\{[A-Z_]+\}\}' <files> <test file>    # must print nothing
grep -niE 'your[-_ ]?(project|ref|user|owner|id|connector)|placeholder|changeme|xxxx|lorem|dummy' <files>    # must print nothing
awk 'FNR==1{f=0;b=0;r=0} /^[ \t]*```/{f=!f} f{next} /^[ \t]*$/{if(++b>1){print FILENAME":"FNR": blank-line run"; bad=1}; next} {b=0} /^---[ \t]*$/{if(r){print FILENAME":"FNR": doubled ---"; bad=1}; r=1; next} {r=0} END{exit bad}' <files>    # layout
```

Before writing a Supabase value, check its shape, and treat a mismatch as unanswered:

```bash
printf '%s\n' "$ref" | grep -qxE '[a-z0-9]{20}'                                         # project ref
printf '%s\n' "$owner_id" | grep -qxiE '[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}'      # user ID
```

**f. Commit and remote**, per the step-3 answers:
- Commit yes: run `git init` first if the target is not a repository, stage the files this bootstrap created or merged (plus the already-uncommitted files only if the user said to include them), confirm with `git status` that nothing ignored-worthy (`node_modules/`, build output, `.claude/project-instructions.local.md`) is staged, and commit as `Set up the project workflow (dev-tools @ <DEV_TOOLS_SHA>)`.
- Remote yes: check `gh auth status` first; then `gh repo create <name> --<public|private> --source . --remote origin --push`. If `gh` is missing or signed out, skip it and say how to do it later.

**Never push without a yes to the step-3 remote question; with an existing remote, leave the push to the user.**
Why: a push publishes, and for a public repo it cannot be taken back.

## 6. Maintainers only: scrub registration

Skip this step silently unless `~/.config/dev-tools/scrub/` exists; it serves only dev-tools maintainers, whose push gate reads that private folder.

When it exists, and only on approval: create `denylist.d/<project>.txt` there (project name, repo slug, Supabase ref, and any IDs gathered, one per line), create `vocab.d/<project>.txt` (below), and add a `sources.txt` line (`<absolute repo path> <subpaths>`, the source directories whose file names identify the project). Never write any of them inside any repo.
Why: later distillation from this project into dev-tools is then blocked from leaking its names, and warned on its vocabulary.

**Derive `vocab.d/<project>.txt` from the target as read in step 2: its distinctive domain nouns, table and function names, and product names, one whole word per line. Favor precision over recall, and leave out plain dictionary words.**
Why: the gate warns on every bounded match, inside snake_case and camelCase identifiers too (the rule is in the header of dev-tools' `scripts/scrub.sh`), so a common word floods each scan with hits that bury the one that identifies the project.

Create it in the same registration: the gate stops with exit 2 when `vocab.d/` holds no entries, and a project registered without its own file is checked for its names but never for its vocabulary.

## 7. Report

- Files created, and files merged (with what was kept); everything but `.claude/project-instructions.local.md` is meant to be committed.
- Optional blocks kept and stripped, the test path and command, and any `CLAUDE.md` note flagged as contradicting a template rule.
- Checks: one line for each check this run made, ending `recorded: <the command as CLAUDE.md records it>` when the repo can rerun it, else `bootstrap only`. The doc-contract test is recorded as `DOC_CONTRACT_CMD`, its template-token check as `DOC_CONTRACT_CMD -t "template token"`, and the build as `BUILD_CMD`. The source pin, the break-and-restore proof, the step-5e `{{`, placeholder, stand-in and layout checks, the Supabase shape checks and the staging check are bootstrap only; an ADOPT's pre-run is the template-token check, so it is recorded.
- The commit made (its short SHA) or not, and the remote created and pushed or not.
- Copying the instructions again: the one-line command for this platform with the file's full path (macOS `pbcopy < <path>`; Windows PowerShell `Get-Content -Raw -Encoding utf8 <path> | Set-Clipboard`, untested on Windows; Linux the first of step 5d's three tools that `command -v` finds, even when the user said no there), and where to paste: the Claude.ai Project's custom instructions.
- Left for the user: paste the instructions as above, then start a fresh planning chat; apply any schema steps by hand; each command written as `NOT SET UP YET`, with what to add; replace the example epic in `ROADMAP.md`, if it was kept; after an ADOPT, describe the existing features in the spec; "regenerate the Claude.ai instructions after the backend exists", if there was none; push, if a remote existed.
- CI templates are not yet part of this skill.
