# dev-tools

Portable Claude Code skills and dev tooling, offered as-is. No support is promised; issues and pull requests may go unanswered.

## Skills

| Skill | What it does |
| --- | --- |
| [`ci-minutes-audit`](skills/ci-minutes-audit/SKILL.md) | Read-only analyzer of a repo's GitHub Actions history: where the billed minutes went, and which levers would cut them. Includes a default CI shape, verified billing facts, lessons, and a worked case study. |
| [`doc-system`](skills/doc-system/SKILL.md) | A spec, windowed changelog, forward-only roadmap, decision records and handoffs, held to shape by a vitest contract test. Seeds a new repo or adopts an existing one's docs without rewriting them. |
| [`project-bootstrap`](skills/project-bootstrap/SKILL.md) | Sets up the planning → Claude Code workflow in a new or existing repo: `CLAUDE.md`, the doc system, a committed permission rule and the Claude.ai planning instructions. |
| [`vitest-suite-speed`](skills/vitest-suite-speed/SKILL.md) | Measure-first method for a slow vitest suite, and the node/jsdom environment split to set up in a new project. |

## Install

```bash
git clone https://github.com/michaelkwright/dev-tools.git
cd dev-tools
./install.sh
```

`install.sh` links each folder under `skills/` into `~/.claude/skills/` as an absolute symlink, so a `git pull` here updates the skills everywhere. It is safe to re-run. A symlink that points elsewhere is repointed (and the old target is printed). A real file or directory already at that name is never touched: the script refuses it and exits non-zero. Set `CLAUDE_SKILLS_DIR` to install somewhere other than `~/.claude/skills`. A folder without a `SKILL.md` is skipped with a notice.

## Starting a project

Install the skills, then open Claude Code in the new (or existing) repo and ask it to bootstrap the project. It reads the repo first, asks only what it can't detect, and never overwrites an existing file without showing you the merge. You get:

- a `CLAUDE.md` with the session workflow, gates and failure-pattern conventions;
- the doc system (spec, changelog, roadmap, decisions, handoffs, audits) and its contract test, run green;
- for Supabase projects, a committed `.claude/settings.json` rule denying `supabase db push`;
- the Claude.ai planning instructions, written to a gitignored local file for you to paste into your Claude.ai Project's custom instructions.

The two source templates are in [`skills/project-bootstrap/templates/`](skills/project-bootstrap/templates/).

## Rule: nothing project-specific goes in here

Every example is anonymized ("a solo-built React + Supabase app"). No project names, repo names, commit SHAs, workflow run IDs, keys or account IDs. Anything that names a specific repo, job or ID comes in through a command-line argument or an environment variable, never from a file in this repo. A secret scan runs on every push.

## Maintainer scrub gate

Pushes run `scripts/scrub.sh`, which scans the working tree and full history with gitleaks and against a private denylist kept outside the repo (`~/.config/dev-tools/scrub`, or `SCRUB_CONFIG_DIR`). It fails closed: a missing config or tool blocks the push. The hook in `.githooks/pre-push` only activates in clones that run `git config core.hooksPath .githooks`, so if you cloned this repo you can ignore all of it.

## License

[MIT](LICENSE).
