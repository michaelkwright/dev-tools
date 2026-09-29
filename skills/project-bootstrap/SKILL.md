---
name: project-bootstrap
description: Use to set up the planning → Claude Code workflow in a new repo, or to adopt it into an existing one (including one scaffolded by another tool), or when the user asks to bootstrap a project.
---

# Project bootstrap

Seeds a repo with a `CLAUDE.md`, the doc system and its contract test, a committed permission rule, and the Claude.ai planning instructions. The rules live in the templates and in the doc-system skill; this file only sequences them. "The target" below is the repo being bootstrapped; "dev-tools" is the checkout this skill lives in.

## 1. Locate and verify the source

```bash
skill_dir="$(dirname "$(readlink -f <absolute path of this SKILL.md>)")"
dev_tools="$(git -C "$skill_dir" rev-parse --show-toplevel)"
git -C "$dev_tools" status --porcelain                      # must print nothing
git -C "$dev_tools" merge-base --is-ancestor HEAD '@{u}'    # must exit 0
git -C "$dev_tools" rev-parse --short HEAD                  # DEV_TOOLS_SHA
```

**Refuse to continue if the checkout is dirty or HEAD is not contained in its upstream; tell the user to commit and push dev-tools first.**
Why: every seeded file records `DEV_TOOLS_SHA`, which must name content anyone can look up.

Read every template from this checkout: `templates/` next to this file, and `skills/doc-system/` (its `SKILL.md`, `templates/`, `reference/`).

## 2. Detect before asking

Read the target and derive every placeholder default from what is there (each template's TEMPLATE NOTES comment lists its placeholders and defaults):

- `package.json`: name, scripts (build, typecheck, test), the test runner in dependencies, the lockfile's package manager; any `vitest.config.*` or a `test` key in `vite.config.*`.
- Framework markers: vite, react, phaser. `TYPECHECK_CMD` is the typecheck script if one exists, else the `tsc` step the build script runs (e.g. `npx tsc -b`).
- `supabase/` (suggests the database and supabase blocks; `supabase/.temp/project-ref` holds a linked ref), `.github/workflows/` (a workflow with a `schedule:` trigger fills `SCHEDULED_CI_CMD`).
- Existing `CLAUDE.md`, `.claude/settings.json`, `.gitignore`, and every doc the doc-system ADOPT inventory names.
- The git remote, and visibility via `gh repo view --json visibility` when `gh` is available and the remote is on GitHub; otherwise ask.
- The contract-test path: `src/test/doc-contracts.test.ts` by default; beside the repo's existing tests if they live elsewhere; and outside any tsconfig `include` that lacks node types, since the test imports `node:fs`.

**Already bootstrapped** means `CLAUDE.md` carries a `Seeded from dev-tools @` line and the limits markers, the contract test exists, and (if `CLAUDE.md` has a Supabase section) `.claude/settings.json` holds the deny rule. If so, run step 5e only, change nothing, and report "already bootstrapped from dev-tools @ <recorded SHA>; nothing changed". Never re-seed or update files the project now owns. If only some pieces exist, do only the missing ones.

## 3. Ask only what detection can't answer, in one batch

- Project name (default: detected), one-line pitch, launch target, launch-blocking concerns. The pitch is also `PRODUCT_SUMMARY` unless the user gives a longer one.
- Which optional blocks apply: `database`, `supabase` (only with database), `digest`, `strategy`, `llm`, `domain-skill`; plus, for each one kept, its values (strategy: the two doc paths; digest: its location and date pattern; domain-skill: its path).
- Supabase block only: project ref, owner user ID, read-only and writable MCP connector names.
- Local timezone (`LOCAL_TZ`). `SECOND_TZ` defaults to Asia/Tokyo, or America/New_York when local is within three hours of Tokyo.
- Visibility, if detection could not tell.

**If the target is public, no project ref or ID goes into any committed file: write `$SUPABASE_PROJECT_REF` in place of the ref and add a line under that code block saying the ref is kept out of the repo, set it locally. Say so to the user.**
Why: a public repo publishes everything committed to it, forever.

## 4. Seed or adopt, never clobbering

**For every target file that already exists, show the proposed merge and apply it only on approval.**
Why: the project's existing notes and settings are its own, and a bootstrap that overwrites them loses work silently.

- Existing `CLAUDE.md`: the filled template, with the old content kept verbatim under a `## Project Notes` section just before `## Known Failure Patterns`; a leading H1 title is dropped, and the proposal says so. Flag any old note that contradicts a template rule instead of choosing between them.
- Existing docs: the doc-system ADOPT mode decides.
- Existing JSON: merged key by key; arrays are unioned; the result must parse.

## 5. Write, in this order

**a. `CLAUDE.md`** from `templates/CLAUDE.md.tmpl`:
- Fill every placeholder. `DOC_CONTRACT_CMD` is `npx vitest run <test path>`; `DOC_CONTRACT_LIMITS` is doc-system's `reference/limits.md` below its rule, filled from the test's `CONFIG`. A command the repo does not have yet gets its default and goes on the report's list.
- Keep or strip each optional block; delete the `BEGIN:`/`END:` marker lines of kept blocks, and stripped blocks entirely.
- Keep the `doc-contract-limits:start`/`end` markers. Delete the TEMPLATE NOTES comment.
- Fail if any `{{` remains outside a code fence, or any template placeholder remains anywhere (check below).

**b. Docs and the contract test** by following doc-system's `SKILL.md` (SEED for a repo with no docs, ADOPT otherwise), with the step-2 test path and `CONFIG.root` set to reach the repo root from it. Fill `{{DEV_TOOLS_SHA}}` in the test's header comment too.
- If vitest is absent, ask before adding it as a dev dependency with the repo's package manager.
- For test-environment setup (node vs a DOM environment), point to the vitest-suite-speed skill; do not set it up here.

**c. `.claude/settings.json`**, committed. With the supabase block kept, merge in:

```json
{ "permissions": { "deny": ["Bash(supabase db push:*)", "Bash(npx supabase db push:*)"] } }
```

Without that block there is nothing to add; create no file.

**d. The Claude.ai instructions**: fill `templates/claude-ai-project-instructions.md.tmpl` the same way (placeholders, blocks, marker lines, TEMPLATE NOTES, the `{{` check) and write it to `.claude/project-instructions.local.md`, which is never committed and so may hold the real ref and IDs. Add that path to `.gitignore`.

**e. Run the scoped doc-contract command** (`DOC_CONTRACT_CMD`) in the foreground, unpiped, and read its exit code. It must be green. If the repo has a build command, run it once too; a test file that breaks the typecheck is not done.

Placeholder check, over every Markdown file written or merged:

```bash
awk 'FNR==1{f=0} /^[ \t]*```/{f=!f; next} !f && /\{\{/{print FILENAME":"FNR": "$0; bad=1} END{exit bad}' <files>
grep -nE '\{\{[A-Z_]+\}\}' <files> <test file>    # must print nothing
```

Leave everything uncommitted for the user to review unless they ask for a commit.

## 6. Offer scrub registration

Only if `~/.config/dev-tools/scrub/` exists, and only on approval: create `denylist.d/<project>.txt` there (project name, repo slug, Supabase ref, and any IDs gathered, one per line) and add a `sources.txt` line (`<absolute repo path> <subpaths>`, the source directories whose file names identify the project). Never write either inside any repo.
Why: later distillation from this project into dev-tools is then blocked from leaking its names.

## 7. Report

- Files created, and files merged (with what was kept).
- Optional blocks kept, and the test path and command.
- Left for the user: paste `.claude/project-instructions.local.md` into the Claude.ai Project's custom instructions; apply any schema steps by hand; any command that does not exist yet.
- CI templates are not yet part of this skill.
