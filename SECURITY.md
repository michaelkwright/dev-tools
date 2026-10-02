# Security policy

## Reporting a vulnerability

Report vulnerabilities privately through GitHub's private vulnerability reporting: open this repository's **Security** tab and choose **Report a vulnerability**. Please do not open a public issue for a security problem.

There is no email address for reports, and no response time is promised.

## Scope

- **Scripts:** `install.sh`, `scripts/`, and the scripts inside skill folders (such as `ci-minutes-audit/ci-minutes.mjs`).
- **The audit SQL:** `skills/supabase-hardening/audit/posture-audit.sql`, including any way it could miss what it claims to check, or write to a database despite being read-only.
- **The templates:** every file under a skill's `templates/`, including any grant, policy or default they leave open that they claim to close.
- **The skills themselves.** A `SKILL.md` and its reference files are instructions an AI agent follows with the user's permissions. A way to make an agent following one of them take an action the user did not ask for (prompt injection through a skill, a template or a file a skill tells the agent to read) is in scope.

Out of scope: the third-party tools these skills call (`gh`, `gitleaks`, vitest, PGlite, Supabase itself); report those to their maintainers.
