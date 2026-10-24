# Cross-repo conventions

An index of the conventions every bootstrapped repo shares, and of where each one is implemented. The rules themselves live in the templates, the settings rules and the skills; this file names them, so a reader can check one repo against the rest. Only section 1 is written out in full.

## 0. Scope and how to read this

**Skills under `skills/` reach every project live through `install.sh`; files under `templates/` are copied, stamped with the dev-tools commit and become the project's own, so a convention change reaches an existing repo only through a per-project change.**
Why: a template edit changes the next bootstrap, not the repos already seeded, so a convention stated only here is one no existing repo has yet.

Each convention below is one bold principle with a `Why:` line, then three lines:
- Implemented in: the template blocks, settings rules, contract-test `CONFIG` fields or skill files that carry it.
- Invariant: what must read the same in every repo.
- Project-owned: what each repo fills in or may change.

A line marked "convention; not yet in the template" is agreed but carried by no template yet, so a repo cannot drift from it.

**A repo drifts when a rule bootstrap wrote is missing or loosened, an invariant line is reworded, or a block that should be kept is stripped.**
Why: each of the three leaves a repo looking set up while one protection is gone, and none of them fails a build.

## 1. Credentials

**One limited-permission credential per project, stored outside every repo at `~/.config/<slug>/supabase-token` with mode 600, loaded only in that project's shell.**
Why: a shared credential becomes the one that one project revokes or mis-scopes for the other, and a shell that exports it for every folder hands one project's token to another's session.

`<slug>` is the project name, lowercased, spaces as dashes (`order-desk`). Limited permission means a scoped access token from the Supabase dashboard, reaching this one project with only the permissions its CLI calls need ([Supabase's access tokens](https://supabase.com/docs/guides/platform/personal-access-tokens)).

**The shell profile exports `SUPABASE_ACCESS_TOKEN` from that file only when the shell starts inside that project's repo folder, and nothing else exports it anywhere; check the profile with `bash -n` (`zsh -n` for a zsh profile) after editing it, then run `supabase logout`, so no account-wide login remains to fall back on.**
Why: a CLI with a stored login falls back to it whenever the variable is missing, so a project whose token failed to load runs with the account's full reach and nothing says so.

One case arm per project, in the file your shell reads when it starts: `~/.zshrc` for zsh (the Mac default), `~/.bash_profile` for bash on a Mac, `~/.bashrc` for bash on Linux; check it with `zsh -n` or `bash -n` to match:

```bash
case "$PWD" in
  "$HOME/projects/<slug>"|"$HOME/projects/<slug>"/*)
    [ -r "$HOME/.config/<slug>/supabase-token" ] && export SUPABASE_ACCESS_TOKEN="$(cat "$HOME/.config/<slug>/supabase-token")" ;;
esac
```

The profile runs once, when the shell starts, so a terminal opened in another folder and then moved into the project has no token: open a new terminal in the project's folder.

**Every CLI call is the plain command, `supabase ...`, never prefixed by `env`, an inline assignment, `npx`, `sh -c` or any wrapper.**
Why: committed rules match the command text from its start, and a wrapper makes a different string of the same action; a session that needs a different credential has found a setup bug, not a reason to prefix.

**The session-start check tests only that the variable is non-empty, and never prints, echoes, compares or logs its value.**
Why: unset is the common silent failure (a 403 three steps later), and a check that reads the value is a check that can leak it.

**Committed denies, listed in `CONFIG.settingsRules`: the token folder is unreadable and unwritable to file tools and to the Bash file commands and redirections those rules reach; the wrapped `supabase` form is denied; the variable's name is denied in any command text; the environment-dumping commands are denied.**
Why: a rule not committed is not in the next clone, and one not in the ratchet can be deleted unseen.

**Known limits: the denies match command text and named paths, so they cannot catch a program invoked by path or inside `sh -c` or `bash -c`; a script or tool that reads its own environment; `$HOME` or a variable in place of the literal path; or a read-only command that reads files without naming them (`grep -r` from a parent folder). The limited permission on the token is the control that holds when a rule does not.**
Why: a session that believes the denies are a boundary stops looking at what runs past them, and only the token's own scope limits what a leaked value can do.

`permissions.blockReadsOutsideWorkingDirectories` is not the answer: with it on, a skill still loads through its `~/.claude/skills` symlink but cannot read its own files, which breaks any skill that reads its templates, project-bootstrap included.

- Implemented in: `CLAUDE.md.tmpl`'s `supabase-cli` blocks (the Supabase section and Running in auto mode); `session-start.sh.tmpl`'s `supabase-cli` block; `SKILL.md` step 3's CLI row and step 5c's credential denies, listed in `CONFIG.settingsRules`; `GETTING-STARTED.md` section 7, "CLI token".
- Invariant: the path pattern `~/.config/<slug>/supabase-token`, mode 600, the variable name `SUPABASE_ACCESS_TOKEN`, the plain-command rule, the check's shape (non-empty, never read), and the deny shapes.
- Project-owned: the slug and the token.

## 2. Permission rules

**Permission rules live only in the committed `.claude/settings.json`, and every rule bootstrap writes is listed in `CONFIG.settingsRules`; pushes that deploy and every writable-connector call ask each time, and a block is reported, never routed around.**
Why: only the committed file travels with every clone, and a rule outside the ratchet can be deleted unseen.

How rules match ([Claude Code's permissions docs](https://code.claude.com/docs/en/permissions)): a trailing ` *` or `:*` is a prefix that also matches the bare command, and `:*` counts only at the end of a rule; a `*` anywhere else matches any text, spaces included. Deny and ask rules match past any leading `VAR=value` assignment. Claude Code strips only a fixed wrapper list before matching (`timeout`, `time`, `nice`, `nohup`, `stdbuf`, `command`, `builtin`, zsh's `noglob`, and `xargs` without flags), so `env` and `npx` are matched as commands of their own.

- Implemented in: `SKILL.md` step 5c (push denies, `supabase db push` denies, `apply_migration` deny or ask, writable-connector asks, push asks, credential denies); `CLAUDE.md.tmpl`, Running in auto mode; doc-system's settings ratchet (`CONFIG.settingsRules`).
- Invariant: every rule string step 5c writes, and its listing in `CONFIG.settingsRules`.
- Project-owned: rules the project adds itself, and the connector name the MCP rules are keyed to.

## 3. Prompt shape and stop points

**A prompt is one copy-paste block, names its model by role, covers only the work between two stop points, and is drafted only after the previous prompt's report.**
Why: each report can change what the next prompt should say, and a prompt that runs past a stop point either stalls there or skips it.

Stop points are anything only the human can clear: a dashboard paste, a spend approval, grading, an on-device check, a push or deploy ask.

- Implemented in: the instructions template's Drafting Claude Code Prompts section (model by role, one copy-paste block, one prompt at a time, ask-rule prompts are not unattended). The stop-point scoping line is a convention; not yet in the template.
- Invariant: one block, the model by role, one prompt at a time.
- Project-owned: the model mapping, and the project's own stop points.

## 4. Spend

**The app's own model API key is spent only where the app requires it, and only after an estimate, a cap and an approval in chat, all before the prompt is drafted.**
Why: a retry loop can spend far more than the task needs before anyone looks.

- Implemented in: the instructions template's `llm` block; the `llm-call-hygiene` skill's capped runner.
- Invariant: estimate and cap before the prompt; the subscription for offline work.
- Project-owned: the cap's amount.

## 5. Database changes

**Database changes are SQL paste files, each proved by a rolled-back probe before the human pastes it; `supabase db push` is denied, and `apply_migration` is denied or asked.**
Why: a paste is the one step no test sees, so its proof has to come before it.

**A paste block guards the exact live state it was written against, so it fails rather than applies when that state has moved.**
Why: a paste written against yesterday's schema applies cleanly to today's and does something else.

- Implemented in: `CLAUDE.md.tmpl`'s `database` block (the rolled-back proof) and `schema-by-hand` / `schema-by-claude` blocks (the `schema-by-hand` block carries the paste guard); `SKILL.md` step 5c (`supabase db push` denies, `apply_migration` deny or ask); the `supabase-hardening` skill.
- Invariant: the rolled-back proof, the paste guard on the by-hand path, the push deny, `apply_migration` never unruled.
- Project-owned: which schema path (by hand or by Claude), and the paste files.

## 6. Docs and handoffs

**`CLAUDE.md` is the single source of workflow, `ROADMAP.md` holds unbuilt work only, decision records hold reasoning, and a handoff carries live state only; each handoff supersedes the last, and the superseded one gets a pointer header and moves to `archive/`.**
Why: two copies of a rule drift apart, and state left in a superseded handoff disappears with it.

- Implemented in: the `doc-system` skill and its contract test; `CLAUDE.md.tmpl`'s Document Map; the instructions template's Document Map and repo-reading blocks.
- Invariant: the doc map, the handoff path shape and the supersede-and-archive rule.
- Project-owned: the docs' content, and the fitted `CONFIG` after an adopt.

## 7. Test gates

**Scoped runs while iterating; one full run on the final bytes; a nightly scheduled run as the backstop, with a session-start check of its latest result.**
Why: every full run before the last proves nothing the last does not, and a backstop nobody reads catches nothing.

**Before the gate, `vitest related` over the changed files plus a grep for every changed symbol.** (convention; not yet in the template)
Why: a scoped run of the touched file misses the tests that import it, and a renamed symbol can survive in a file no import reaches.

- Implemented in: `CLAUDE.md.tmpl`'s Gates section (session order, one full suite per session) and `scheduled-ci` block; `session-start.sh.tmpl`'s `scheduled-ci` block; the `ci-minutes-audit` skill's scheduled-suite shape.
- Invariant: one full suite per session, on the final bytes; the scheduled run checked at pre-flight.
- Project-owned: the commands, the timezones and the schedule.

## 8. Session-start check

**One committed script of the same shape in every repo, `scripts/session-start.sh`, run at pre-flight: the CLI token variable is set (never printed), `git config core.hooksPath` names the guard folder, and the latest scheduled CI run is shown when the repo has one.**
Why: a pre-flight check kept only in prose is rebuilt from memory each session, and a script fails the same way every time.

- Implemented in: `templates/session-start.sh.tmpl` (blocks `supabase-cli`, `push-guard`, `scheduled-ci`); `SKILL.md` step 5c; `CLAUDE.md.tmpl` Session Workflow.
- Invariant: the path, one stderr line per failure, a non-zero exit on any failure, the value never printed.
- Project-owned: which blocks are kept, the scheduled-CI command, and checks the project adds.

## 9. One machine, several projects

**Assume another project's session may be running on this machine; each project has one connector pair and one credential of its own, and nothing account-wide.**
Why: parallel sessions share one machine and one account, so anything account-wide lets one project's session act on another's data.

**Any change to the shell profile, `~/.config`, a shared account, dev-tools or a cross-project convention is checked against every project before it is applied.** (convention; not yet in the template)
Why: those are the places every project reads from, so a change made for one lands in all of them.

Registering a project's file names in the scrub config can turn plain words into blocking stems, so dev-tools' scrub gate is run after any registration and the new stems triaged before its next push.

- Implemented in: `CLAUDE.md.tmpl` Session Workflow (the parallel-session rule) and `connectors` block; `SKILL.md` step 3 (scoped connectors, the account-wide refusal); section 1 above; `GETTING-STARTED.md` section 8.
- Invariant: the parallel-session rule, connectors and credentials scoped to one project.
- Project-owned: the connector names and the slug.

## 10. Drift audit

**A periodic audit compares each repo's `CLAUDE.md` blocks and `.claude/settings.json` rules against this document, and reports each drift by kind: a rule missing or loosened, an invariant line reworded, a block stripped that should be kept.**
Why: the settings ratchet catches a deleted rule in its own repo, but only a comparison across repos catches a reworded invariant or a block that was never there.

- Implemented in: this document; doc-system's settings ratchet catches the first kind between audits.
- Invariant: the three drift kinds from section 0.
- Project-owned: when the audit runs.
