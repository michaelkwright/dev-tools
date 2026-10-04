---
name: project-bootstrap
description: Use to set up the planning → Claude Code workflow in a new repo, or to adopt it into an existing one (including one scaffolded by another tool), or when the user asks to bootstrap a project.
---

# Project bootstrap

Seeds a repo with a `CLAUDE.md`, the doc system and its contract test, committed permission rules, and the Claude.ai planning instructions. The rules live in the templates and in the doc-system skill; this file only sequences them. "The target" below is the repo being bootstrapped; "dev-tools" is the checkout this skill lives in.

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
  - `TZ_TEST_GREP`: the default grep over every directory this step finds holding source or tests, the repo root included. When the root itself holds source or test files, search `.` with `--exclude-dir=node_modules --exclude-dir=.git`, one `--exclude-dir` for each build output folder, and `--exclude='*.md'`, since `CLAUDE.md` records the grep's own search words and would match every run; otherwise list the directories, never `src/` alone unless it is the only one.
- Framework markers (vite, react, phaser): a DOM framework means the report points to the vitest-suite-speed skill for the test-environment split.
- `supabase/` suggests the database and supabase blocks; `supabase/.temp/project-ref` holds a linked ref, which step 3 asks the user to confirm as this app's project. `supabase/migrations/` names tables the step-5e scoping check can read.
- MCP configs in the target: `.mcp.json`, `.cursor/mcp.json` and `.vscode/mcp.json`, for the step-5e connector check.
- Scheduled CI: a `.github/workflows/` file with a `schedule:` trigger keeps the `scheduled-ci` block and fills `SCHEDULED_CI_CMD` with that file's name. With none, the block is stripped without asking.
- Strategy docs: a Markdown file whose name or first heading marks it as strategy, positioning or launch plan (`STRATEGY.md`, `docs/launch-plan.md`, say). Only a found doc lets step 3 offer the `strategy` block; with none, it is stripped without asking.
- `LOCAL_TZ`: the system timezone, from `node -p 'Intl.DateTimeFormat().resolvedOptions().timeZone'`, else the zone name in `readlink /etc/localtime`. Step 3 only confirms it.
- Git: whether the target is a repository (`git rev-parse --is-inside-work-tree`), its remotes (`git remote -v`), and anything already uncommitted (`git status --porcelain`), for step 5f and the report's GitHub ruleset line.
- Existing `CLAUDE.md`, `.claude/settings.json`, `.gitignore`, and every doc the doc-system ADOPT inventory names. SEED when none of the doc-system files exist (its seed set; `CLAUDE.md` and a README are not among them); ADOPT otherwise.
- Visibility: `gh repo view --json visibility` when `gh` is available and the remote is on GitHub; otherwise ask.
- The contract-test path: `src/test/doc-contracts.test.ts` by default. Use the repo's test directory if tests live elsewhere. If a tsconfig includes the path without node types, use a top-level `test/` outside every tsconfig instead, since the test imports `node:fs`.

**When the source sits at the repo root rather than in `src/`, put the contract test where this step found existing tests, else in `test/` at the root; never create a `src/test/` that holds only it.**
Why: a `src/` holding nothing but a test folder reads as the start of a layout the repo does not have, and the next session puts code there.

**Already bootstrapped** means every piece exists: `CLAUDE.md` with a `Seeded from dev-tools @` line and the limits markers; the doc system (the seed set, or the files its ADOPT mapping named); the contract test; `.claude/settings.json` with the step-5c push denies, plus the `supabase db push` deny if `CLAUDE.md` has a Supabase section; and the `.gitignore` line. If so, skip steps 3 to 6 and change nothing tracked. Run step 5e with the command recorded in `CLAUDE.md`, and report "already bootstrapped from dev-tools @ <recorded SHA> (current: <DEV_TOOLS_SHA>); nothing changed" with the 5e results. Never re-seed or update files the project now owns. If only some pieces exist, do only the missing ones. `.claude/project-instructions.local.md` is untracked, so it is not a piece: when it is missing, or the user asks to regenerate it (once the backend or its connectors exist, say), offer step 5d alone, asking only the step-3 questions it needs. A regeneration after the backend or connectors come to exist also offers, each as a shown merge, what the first run held back: `CLAUDE.md`'s `connectors` and `migration-deny` blocks and the step-5c `apply_migration` deny.

## 3. Ask only what detection can't answer, in one batch

**Ask in plain words a first-time user can answer, never in this file's vocabulary (block names, placeholder names); the table maps each answer to what it sets.**
Why: a question the user cannot parse gets a guessed answer, and a guess written into the instructions reads as fact to every later session. "Connector" is allowed, since Claude.ai's own menu uses it (Customize → Connectors).

| Ask | Sets | Ask only when |
|---|---|---|
| "What's the project called?" (suggest the `package.json` name, else the directory name) | `PROJECT_NAME` | always |
| "In one sentence, what does it do, and for whom?" | `PROJECT_PITCH`, and `PRODUCT_SUMMARY` unless they give a longer one; fill it as a sentence ending in a full stop, since the template runs straight on | always |
| "What will count as launched, and by when?" | `LAUNCH_TARGET`, without a closing full stop (the template adds one), with a relative date made absolute (below) | always |
| "What must be true before launch? (For example: no user can ever see another user's data.)" | `LAUNCH_BLOCKERS`, without a closing full stop | always |
| "Will the app keep its data in a database?" | `database` block (both templates) | always; suggest yes when `supabase/` exists |
| "Will that database be Supabase?" | `supabase` block (both templates) | the answer above is yes |
| "Have you created the Supabase project yet?" With a linked ref found, ask instead: "I found a linked Supabase project, `<ref>`. Is that this app's project?" | whether the project exists: only a yes asks the rows below; anything else takes the no-backend path below | Supabase |
| "Have you set up this project's two database connectors yet? (One that can only read, added in Claude.ai; one that can also change data, added in Claude Code. Each is tied to this one Supabase project: its address includes `project_ref=` and this project's ID.)" | the no-connectors path below | the project exists |
| "Will you apply database changes yourself in the Supabase dashboard, or let Claude apply them? (Recommended: yourself.)" | yourself, or no answer: the `schema-by-hand` and `migration-deny` blocks and the step-5c `apply_migration` deny; Claude: the `schema-by-claude` block | the project exists |
| "What are their names? And is each one tied to this project only, or can it reach every project in your Supabase account?" | `SUPABASE_RO_CONNECTOR`, `SUPABASE_RW_CONNECTOR`; an account-wide writable one is refused (below) | the connectors exist |
| "What's the project's ID? It's the short code after `/project/` in the Supabase dashboard's address." | `SUPABASE_PROJECT_REF` | the project exists and no linked ref was found |
| "Have you signed up in your own app yet? If so, what's your user ID? (Supabase dashboard → Authentication → Users, your row.)" | `OWNER_USER_ID` | the project exists |
| "Is the app for many people, each with their own account, or just for you?" | `multi-user` block (instructions), kept only for many people | always |
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

The `database`, `supabase`, `schema-by-hand` and `schema-by-claude` blocks are in both templates; `scheduled-ci`, `connectors` and `migration-deny` in `CLAUDE.md` only; and `strategy`, `digest`, `llm`, `domain-skill` and `multi-user` in the instructions only. When the schema question is not asked (no Supabase project yet, or a database that is not Supabase), `schema-by-hand` is kept and `schema-by-claude` and `migration-deny` are stripped.

**Ask the remote question once, as its own follow-up after the batch is answered, and only when `git remote` lists none and the commit answer is yes: "Create a `<visibility>` GitHub repo named `<name>`, and upload this commit to it?", with the visibility the batch settled or detection found (`<name>`: the project name, lowercased, spaces as dashes; the user may change it).**
Why: the question names the visibility, so asked inside the batch it states a guess the user may not have settled yet.

**Never write an invented value: a placeholder the user has not answered and detection has not found is stripped with its block, or written as the environment variable below, never filled with a made-up stand-in.**
Why: a stand-in passes every placeholder check and reads as fact, so later sessions build on an ID that does not exist.

**Declining vitest stops the bootstrap before anything is written.**
Why: the doc check runs on it, and a bootstrap that cannot run its own check cannot say its docs are in shape.

**A command answered "later" replaces its whole code span, backticks and any `TZ=` prefix included, with plain text naming the command and marking it, `the <build / typecheck / test> command (NOT SET UP YET: <what to add>)`, never a runnable default; the report lists each one.**
Why: a default command in `CLAUDE.md` reads as working, so a session runs it and builds on its failure.

Adjust only the words around the replacement, and only as far as grammar needs: "→ one `{{BUILD_CMD}}` →" becomes "→ the build command (NOT SET UP YET: …), once →", and "(`TZ={{LOCAL_TZ}} {{TEST_CMD}}`)" becomes ", the test command (NOT SET UP YET: …),".

**Turn a relative date in any answer ("end of next quarter", "in six weeks") into an absolute date, `Month D, YYYY`, counted from today, and confirm it with the user before writing it.**
Why: a relative date is true only on the day it was said, and every later session reads it against its own today.

**No backend yet: when the database is Supabase but the user has not confirmed the project exists, ask nothing more about it. Keep `CLAUDE.md`'s supabase block (with `$SUPABASE_PROJECT_REF` as below) and the step-5c `supabase db push` deny; strip its `connectors` and `migration-deny` blocks and the instructions' supabase block.**
Why: the build rules and the push deny apply from the first migration, while the connector rules name a project and connections that do not exist yet.

**With no backend, the report gives no connector setup steps, only one line: "Create the Supabase project first, then follow the connector section of dev-tools' `GETTING-STARTED.md` (section 7), and regenerate the Claude.ai instructions."**
Why: every connector step needs the project's ref, so steps given before the project exists get followed with a guessed ref or not at all.

The instructions' supabase block is kept only when the ref, the owner user ID and the names of both connectors, each scoped to this project, are all real answers; otherwise it is stripped the same way, and the report says what to finish before regenerating.

**No connectors yet: when the project exists but its two connectors do not, ask nothing more about them, strip `CLAUDE.md`'s `connectors` block and the instructions' supabase block, and give the connector setup below in the report, with "regenerate the Claude.ai instructions after the connectors exist".**
Why: the connector rules name each connector, and a name written before the connector exists reads as one a session can use.

**Refuse an account-wide writable connector: when the user says the one that can change data reaches every project in their account, record no name and go on as if the connectors were not set up; give the scoped setup, and tell them to remove the account-wide one.**
Why: an account-wide connector takes the project ID as an argument on every call, so with sessions open on two projects, one wrong ID changes the other project's database; a connector scoped to one project cannot.

An account-wide read-only connector is not refused, but the report flags it and gives the scoped setup for it.

The connector setup, as the report gives it, in plain steps. `<slug>` is the project name, lowercased, spaces as dashes. `<ref>` is the project's ID: the report fills in the real ref for a private repo and leaves `<ref>` for a public one.

1. The read-only connector, in Claude.ai, for planning chats ([Claude's help page on custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)):
   - Customize → Connectors → "+ Add" → "Add custom connector". On a Team or Enterprise plan an owner adds it under Organization settings → Connectors → Add → Custom → Web, and you then choose Connect under Customize → Connectors.
   - Name: `Supabase <project name> read-only`.
   - Remote MCP server URL: `https://mcp.supabase.com/mcp?project_ref=<ref>&read_only=true&features=database,debugging,functions,docs`.
   - Keep the default sign-in settings, choose Add, and sign in to Supabase when asked.
   - In each planning chat, turn on only this project's connector: "+" → Connectors.
2. The writable connector, in Claude Code at local scope ([Supabase's MCP guide](https://supabase.com/docs/guides/getting-started/mcp), [Claude Code's MCP guide](https://code.claude.com/docs/en/mcp)). From the project's folder:

   ```bash
   claude mcp add --transport http supabase-<slug>-rw --scope local "https://mcp.supabase.com/mcp?project_ref=<ref>&features=database,debugging,functions,docs,development"
   ```

   Then, in a Claude Code session started in that folder, run `/mcp`, choose `supabase-<slug>-rw`, and Authenticate. Local scope stores it in `~/.claude.json` under this folder's path: nothing goes into the repo, and sessions in other projects never load it. Never add it at project scope or in Claude.ai. Add it under exactly the name `supabase-<slug>-rw`, or edit the step-5c `apply_migration` deny to the name used.
3. Regenerate the Claude.ai instructions (step 5d alone) with the two names.

Each URL is built by hand from Supabase's parameters: `project_ref=` scopes the server to one project, `read_only=true` runs every query as a read-only database user, and `features=` turns on only the listed tool groups (`development` holds the project URL, keys and type generation, which planning never needs). Never install either through the Supabase dashboard's one-click Claude.ai install or the Claude.ai connector directory: that route hides the URL, so nobody can see what the connector was scoped to.

**Add the writable connector at local scope, never at project scope.**
Why: project scope writes a `.mcp.json` that is committed with the repo, and a committed `.mcp.json` hands a writable server to every session that opens the repo, in every clone, on every machine.

**If the target is public, or no Supabase project exists yet, no project ref or ID goes into any committed file: write `$SUPABASE_PROJECT_REF` in place of the ref and add a line under that code block saying the ref is kept out of the repo, set it locally. Say so to the user. A private repo keeps the real ref in `CLAUDE.md`'s deploy command.**
Why: a public repo publishes everything committed to it, forever. A ref is an identifier, not a credential, so a private repo may hold it; the report says to swap it out before the repo ever goes public.

## 4. Seed or adopt, never clobbering

**For every target file that already exists, `.gitignore` included, show the proposed merge and apply it only on approval.**
Why: the project's existing notes and settings are its own, and a bootstrap that overwrites them loses work silently.

- Existing `CLAUDE.md` (this skill governs it, not doc-system ADOPT): the filled template, with the old content kept verbatim under a `## Project Notes` section just before `## Known Failure Patterns`; a leading H1 title is dropped, and the proposal says so. Flag any old note that contradicts a template rule, in the proposal and the report, instead of choosing between them.
- Existing docs: the doc-system ADOPT mapping, including the `CONFIG` fit, is part of this proposal, since step 5a needs its values.
- Existing JSON: merged key by key; arrays are unioned; the result must parse.
- Existing `.gitignore`: the merge only appends lines and changes none, and it is shown and approved like any other. It holds the step-5d line, plus `node_modules/` and the build output folder when a commit is wanted and they are missing.
- `package.json` and the lockfile change only through an approved dependency install, or the `test` script the step-3 test answer approved.

## 5. Write, in this order

**Put every temporary file (a restore copy, a captured output) in the session's scratch directory, or inside the target when there is none, and never beside the target; delete each one inside the target before staging.**
Why: the target's parent folder may hold other projects, and a file left there is in nobody's repo and nobody cleans it up.

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

**c. `.claude/settings.json`**, the shared settings file meant to be committed (not `settings.local.json`). Into every target, merge the push denies, and show the merge when the file already exists:

```json
{ "permissions": { "deny": [
  "Bash(git push*--force*)", "Bash(git push* -f*)", "Bash(git push* +*)",
  "Bash(git push*--de*)", "Bash(git push* -d*)", "Bash(git push* :*)",
  "Bash(git push*--m*)", "Bash(git push*--pru*)"
] } }
```

They stop force pushes (`--force`, `-f`, `--force-with-lease`, `--force-if-includes`, a `+refspec`) and remote branch deletion (`--delete`, `-d`, a `:branch` refspec, `--mirror`, `--prune`), with git's abbreviations of those long options (`--del`, `--mir`, `--pru`). A `*` in a Bash rule matches any text, spaces included, at any point in the rule ([Claude Code's permissions docs](https://code.claude.com/docs/en/permissions), "Wildcard patterns"), so each rule matches its option wherever it sits after `git push`. A branch name that happens to contain one of those strings is denied too; that push is the user's to run.

**Name in the report every push form the denies cannot catch (the list under Known limits).**
Why: a Bash rule matches the command text Claude writes, not the program it runs, so a deny is a guard on the usual forms, and a user who thinks it covers every form stops looking.

**When a GitHub remote exists or is created, the report recommends a ruleset on the default branch with "Restrict deletions" and "Block force pushes" ([GitHub's rulesets docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository)); the push denies are the local layer.**
Why: a ruleset is enforced on GitHub's side for every client and every form of the command, which is the control that actually holds.

With the supabase block kept, also merge in:

```json
{ "permissions": { "deny": ["Bash(supabase db push:*)", "Bash(npx supabase db push:*)"] } }
```

With the `migration-deny` block kept (the project exists, and the user applies schema changes by hand), also merge in the writable connector's `apply_migration`, keyed to the name step 3 gave, else to the suggested `supabase-<slug>-rw`:

```json
{ "permissions": { "deny": ["mcp__supabase-<slug>-rw__apply_migration"] } }
```

When the rule is keyed to the suggested name, the report says to add the writable connector under exactly that name or edit the rule to the name used.

**Write the `apply_migration` deny into the committed `.claude/settings.json`, never `settings.local.json`.**
Why: Claude.ai's per-tool toggles never reach Claude Code, and `/permissions` saves a rule to whichever settings file is picked in its dialog, while "don't ask again" approvals land in `.claude/settings.local.json`, which Claude Code keeps out of git ([permissions docs](https://code.claude.com/docs/en/permissions), "Manage permissions"; [settings docs](https://code.claude.com/docs/en/settings)); only `.claude/settings.json` travels with every clone.

**Key every MCP permission rule to a server added in Claude Code by name, never to a Claude.ai connector, and after re-adding any connector, re-check the rules with `/permissions` in a terminal `claude` session.**
Why: Claude.ai connectors appear in Claude Code under ID prefixes (`mcp__claude_ai_<name>__` per the docs, an opaque ID in the desktop app), so a rule keyed to one silently stops matching when the connector is re-added, and a deny that stops matching fails open. In the desktop app's Code tab, `/permissions` opens a mode picker instead of the rule list.

**d. The Claude.ai instructions**: fill `templates/claude-ai-project-instructions.md.tmpl` the same way (placeholders, blocks, marker lines, TEMPLATE NOTES, the checks below). Write it to `.claude/project-instructions.local.md`, which is never committed and so may hold the real ref and IDs, and add that exact path to `.gitignore`.

Then ask "Copy the Claude.ai instructions to your clipboard now?". On a yes, copy the file with the platform's clipboard command and read its exit code: macOS `pbcopy < <file>`; Windows, in PowerShell, `Get-Content -Raw -Encoding utf8 <file> | Set-Clipboard` (`clip` garbles non-ASCII text, and this command is untested on Windows); Linux `wl-copy < <file>`, else `xclip -selection clipboard < <file>`, else `xsel --clipboard < <file>`. If no clipboard tool exists, say so and print the file's contents in the session instead.

**The instructions file stays at `.claude/project-instructions.local.md`, and its contents never go into any committed file.**
Why: it may hold the real ref and IDs, and `.claude/` is a hidden folder, so the copy command in the report is how the user gets at it again.

**e. Run the scoped doc-contract command** (`DOC_CONTRACT_CMD`) in the foreground, unpiped, and read its exit code. It must be green. If the repo has a build script, run it once too: the bootstrap is not done if the new files broke it.

Checks, over every Markdown file written or merged (and the test file where named). They run once, and are broader than the doc-contract test's template-token check, which holds the recorded half: on every doc-contract run it fails any unfilled `UPPER_SNAKE_CASE` token in the docs and `CLAUDE.md`, but never sees the instructions file, a lowercase or partial `{{`, or a stand-in.

```bash
awk 'FNR==1{f=0} /^[ \t]*```/{f=!f; next} !f && /\{\{/{print FILENAME":"FNR": "$0; bad=1} END{exit bad}' <files>
command grep -nE '\{\{[A-Z_]+\}\}' <files> <test file>    # must print nothing
command grep -niE 'your[-_ ]?(project|ref|user|owner|id|connector)|placeholder|changeme|xxxx|lorem|dummy' <files>    # must print nothing
awk 'FNR==1{f=0;b=0;r=0} /^[ \t]*```/{f=!f} f{next} /^[ \t]*$/{if(++b>1){print FILENAME":"FNR": blank-line run"; bad=1}; next} {b=0} /^---[ \t]*$/{if(r){print FILENAME":"FNR": doubled ---"; bad=1}; r=1; next} {r=0} END{exit bad}' <files>    # layout
```

Before writing a Supabase value, check its shape, and treat a mismatch as unanswered:

```bash
printf '%s\n' "$ref" | command grep -qxE '[a-z0-9]{20}'                                         # project ref
printf '%s\n' "$owner_id" | command grep -qxiE '[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}'      # user ID
```

**Run every bootstrap check with `command grep`, and record `type grep` in the report.**
Why: a session shell's `grep` can be a wrapper that honors `.gitignore`, and a recursive search through it skips ignored files, the very files a leak check exists to cover.

With the supabase block kept, check for repo-level MCP configs from the target's folder, with `$ref` empty when no ref is known:

```bash
for f in .mcp.json .cursor/mcp.json .vscode/mcp.json; do [ -f "$f" ] && command grep -liF -e supabase -e project_ref -e project-ref ${ref:+-e "$ref"} "$f"; done    # must print nothing
```

With the project and at least one of its connectors existing, run the scoping check on each of this project's connectors whose tools this session can see under its name:

1. Tool-input test: its `execute_sql` takes no `project_id` input. A server scoped with `project_ref=` drops that input from every tool ([Supabase's MCP README](https://github.com/supabase-community/supabase-mcp)), so one that asks for it reaches every project in the account.
2. Read-only connector only: `select current_user, current_setting('transaction_read_only');` must return `supabase_read_only_user` and `on`.
3. Which project: a read only this project can answer. With a table named in `supabase/migrations/`, `select to_regclass('public.<table>');` must return it; otherwise `select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r';`, which the user compares with the table count the dashboard's Table Editor shows.

**Never probe read-only status with a write to a real table.**
Why: on a connector that turns out writable, the probe is itself the write.

When a connector's tools are not visible here (the read-only one lives in Claude.ai, whose connectors may appear under an ID rather than a name; the writable one loads only in sessions started after it was added and authenticated), the report gives the same checks as one message to send from a planning chat with only that connector turned on, or from a new Claude Code session in the target folder for the writable one, with the answers each should return.

**Never use `claude mcp list` as the scoping check.**
Why: it prints a Claude.ai connector's URL without its query string, so a scoped connector looks account-wide; it does not reliably list every Claude.ai connector; and a configured URL says what was intended, not what the server enforces.

**Flag in the report every repo-level MCP config the first check prints and every connector that fails a check, with the scoped setup; name each connector check not run, and why.**
Why: a committed MCP config hands its server to every session that opens the repo, and a connector that takes a `project_id` reaches every project in the account.

**f. Commit and remote**, per the step-3 answers:
- Commit yes: run `git init` first if the target is not a repository, stage the files this bootstrap created or merged (plus the already-uncommitted files only if the user said to include them), confirm with `git status` that nothing ignored-worthy (`node_modules/`, build output, `.claude/project-instructions.local.md`, any MCP config naming a Supabase server) is staged, and commit as `Set up the project workflow (dev-tools @ <DEV_TOOLS_SHA>)`.
- Remote yes: check `gh auth status` first; then `gh repo create <name> --<public|private> --source . --remote origin --push`. If `gh` is missing or signed out, skip it and say how to do it later.

**Never push without a yes to the step-3 remote question; with an existing remote, leave the push to the user.**
Why: a push publishes, and for a public repo it cannot be taken back.

**The bootstrap commit follows the session's normal commit attribution settings: it adds no trailer they do not add, and removes none they do.**
Why: attribution is the user's configured choice, and a setup commit that edits it on its own misstates who wrote the commit.

## 6. Maintainers only: scrub registration

Skip this step silently unless the scrub config folder exists: `$SCRUB_CONFIG_DIR` when set, else `~/.config/dev-tools/scrub/`, the same lookup as dev-tools' `scripts/scrub.sh`. It serves only dev-tools maintainers, whose push gate reads that private folder.

When it exists, and only on approval: create `denylist.d/<project>.txt` there (project name, repo slug, Supabase ref, and any IDs gathered, one per line), create `vocab.d/<project>.txt` (below), and add a `sources.txt` line (`<absolute repo path> <subpaths>`, the source directories whose file names identify the project). Never write any of them inside any repo.
Why: later distillation from this project into dev-tools is then blocked from leaking its names, and warned on its vocabulary.

**Derive `vocab.d/<project>.txt` from the target as read in step 2: its distinctive domain nouns, table and function names, and product names, one whole word per line. Favor precision over recall, and leave out plain dictionary words.**
Why: the gate warns on every bounded match, inside snake_case and camelCase identifiers too (the rule is in the header of dev-tools' `scripts/scrub.sh`), so a common word floods each scan with hits that bury the one that identifies the project.

Create it in the same registration: the gate stops with exit 2 when `vocab.d/` holds no entries, and a project registered without its own file is checked for its names but never for its vocabulary.

The report shows the registration's result: each file written or appended, with its line count, and never its terms.

## 7. Report

- Files created, and files merged (with what was kept); everything but `.claude/project-instructions.local.md` is meant to be committed.
- Optional blocks kept and stripped, the test path and command, and any `CLAUDE.md` note flagged as contradicting a template rule.
- `type grep` as this session's shell reports it.
- Checks: one line for each check this run made, ending `recorded: <the command as CLAUDE.md records it>` when the repo can rerun it, else `bootstrap only`. The doc-contract test is recorded as `DOC_CONTRACT_CMD`, and its template-token check, which runs inside it, gets a line of its own recorded as `DOC_CONTRACT_CMD -t "template token"`; the build is recorded as `BUILD_CMD`. The source pin, the break-and-restore proof, the step-5e `{{`, placeholder, stand-in and layout checks, the Supabase shape checks, the connector checks and the staging check are bootstrap only; an ADOPT's pre-run is the template-token check, so it is recorded.
- The commit made (its short SHA) or not, and the remote created and pushed or not.
- Copying the instructions again: the one-line command for this platform with the file's full path (macOS `pbcopy < <path>`; Windows PowerShell `Get-Content -Raw -Encoding utf8 <path> | Set-Clipboard`, untested on Windows; Linux the first of step 5d's three tools that `command -v` finds, even when the user said no there), and where to paste: the Claude.ai Project's custom instructions.
- Push denies: the forms they stop and every form they cannot catch (Known limits below). When a GitHub remote exists or was created, the ruleset recommendation from step 5c, with its link.
- Connectors, with the supabase block kept:
  - No project yet: only the one line from step 3, and nothing else about connectors.
  - Project exists: each flag from the step-5e connector checks, each scoping check's result (or the message to run it from a chat), the writable connector's local-scope command and both connector URLs from step 3 (the real ref for a private repo, `<ref>` for a public one), and, when the two scoped connectors do not both exist (none yet, or an account-wide writable one refused), the whole connector setup from step 3.
  - The `apply_migration` deny, if written: the name it is keyed to, the keep-this-name line when that name is the suggested one, and the ID-prefix rule from step 5c.
- Left for the user: paste the instructions as above, then start a fresh planning chat; apply any schema steps by hand, unless they chose to let Claude apply them; each command written as `NOT SET UP YET`, with what to add; replace the example epic in `ROADMAP.md`, if it was kept; after an ADOPT, describe the existing features in the spec; the step-3 one-line pointer, if there was no backend, or "regenerate the Claude.ai instructions after the connectors exist", if the backend exists without them; push, if a remote existed.
- CI templates are not yet part of this skill.

## Known limits

- **The push denies match command text, so these forms pass them:** git's global options before `push` (`git -C <dir> push`, `git -c <key>=<value> push`, `git --git-dir=<dir> push`); quoted words (`git 'push'`, `"+main"`, `'--force'`); git run by path (`/usr/bin/git push`) or inside `sh -c`, `bash -c`, `eval`, `xargs` with flags, or an environment runner such as `npx`; bundled short flags where `f` or `d` is not first (`-uf`, `-qd`); a git alias (`git config alias.fp "push --force"`); a configured refspec or mirror (`remote.<name>.push` with a leading `+`, `remote.<name>.mirror`) that turns a plain `git push` into a force push, deletion or mirror; any script or tool that pushes or deletes on its own (an npm script, a Node or Python script, `gh api -X DELETE .../git/refs/heads/<branch>`); a mod whose `tool.check` handler approves the call, outside managed settings and Team or Enterprise plans; and every push the user runs outside Claude Code. The GitHub ruleset in step 5c covers all of them for the default branch.
- **`claude mcp list` cannot prove a connector's scoping:** it prints Claude.ai connectors' URLs without their query strings and does not reliably list every one, so the step-5e scoping check reads the tools and the database instead.
- **MCP rules keyed to Claude.ai connectors fail open:** those connectors appear in Claude Code under ID prefixes, so a rule keyed to one silently stops matching when the connector is re-added. Rules are keyed only to servers added in Claude Code by name, and re-checked with `/permissions` in a terminal `claude` session after any connector is re-added.
