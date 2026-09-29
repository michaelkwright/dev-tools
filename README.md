# dev-tools

Portable Claude Code skills and dev tooling, offered as-is. No support is promised; issues and pull requests may go unanswered.

## Skills

| Skill | What it does |
| --- | --- |
| [`ci-minutes-audit`](skills/ci-minutes-audit/SKILL.md) | Read-only analyzer of a repo's GitHub Actions history: where the billed minutes went, and which levers would cut them. Includes a default CI shape, verified billing facts, lessons, and a worked case study. |
| [`vitest-suite-speed`](skills/vitest-suite-speed/SKILL.md) | Measure-first method for a slow vitest suite, and the node/jsdom environment split to set up in a new project. |

## Install

```bash
git clone https://github.com/michaelkwright/dev-tools.git
cd dev-tools
./install.sh
```

`install.sh` links each folder under `skills/` into `~/.claude/skills/` as an absolute symlink, so a `git pull` here updates the skills everywhere. It is safe to re-run. A symlink that points elsewhere is repointed (and the old target is printed). A real file or directory already at that name is never touched: the script refuses it and exits non-zero. Set `CLAUDE_SKILLS_DIR` to install somewhere other than `~/.claude/skills`.

## Rule: nothing project-specific goes in here

Every example is anonymized ("a solo-built React + Supabase app"). No project names, repo names, commit SHAs, workflow run IDs, keys or account IDs. Anything that names a specific repo, job or ID comes in through a command-line argument or an environment variable, never from a file in this repo. A secret scan runs on every push.

## License

[MIT](LICENSE).
