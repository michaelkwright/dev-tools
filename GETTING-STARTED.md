# Getting started

For someone who has never used git or Claude Code. It walks from an empty computer to a first project set up with this toolkit, a planning chat in Claude.ai, and Claude Code building in a folder on your machine.

Everything here is offered as-is: no support is promised, and nothing is guaranteed to work on your setup. The [README](README.md) says what that means in full.

## 1. What you need

Install each of these with its maker's own instructions (linked), then run the check. A check that prints an error means that piece isn't ready yet.

| You need | Check it with | Get it from |
|---|---|---|
| A Claude plan that includes Claude Code (Pro, Max, Team or Enterprise; the free plan does not), and Claude Code installed | `claude --version` prints a version number, and `claude` lets you sign in with that plan | [Claude Code setup](https://code.claude.com/docs/en/setup); new to the terminal? [Terminal guide](https://code.claude.com/docs/en/terminal-guide) |
| A GitHub account | you can sign in at github.com | [Creating an account on GitHub](https://docs.github.com/en/get-started/start-your-journey/creating-an-account-on-github) |
| git, with your name and email set | `git --version`, then `git config --global user.name` and `git config --global user.email` each print a value | [Set up Git](https://docs.github.com/en/get-started/git-basics/set-up-git), [your name](https://docs.github.com/en/get-started/git-basics/setting-your-username-in-git), [your email](https://docs.github.com/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address) |
| The GitHub CLI (`gh`), signed in | `gh auth status` says you are logged in | [GitHub CLI](https://cli.github.com/), then [`gh auth login`](https://cli.github.com/manual/gh_auth_login) |
| Node.js 22.18 or later on the 22 line, or 24, or 26 or later | `node --version` | [Node.js downloads](https://nodejs.org/en/download) |

About the email: every commit you publish shows it. If you'd rather keep your address private, the email page above explains GitHub's no-reply address.

About Node: the toolkit's tests run on vitest 5, which supports Node 22.12 or later on the 22 line, 24, and 26 or later, but not 23 or 25. Some skills also run TypeScript files directly, which needs 22.18 or later on the 22 line. When in doubt, take the version the Node.js page marks LTS.

## 2. Install the toolkit, and pin it

A **commit** is a saved snapshot of every file in a repo, named by a short code such as `1a2b3c4`. Pinning means choosing one commit you have read and staying on it.

A skill is a set of instructions Claude Code follows with your permissions, so read one before you install it, as you would read a script before running it. In a macOS or Linux terminal (on Windows, use WSL):

```bash
git clone https://github.com/michaelkwright/dev-tools.git ~/dev-tools
```

```bash
cd ~/dev-tools
```

```bash
git log --oneline -1
```

Write down the code that last command prints: it is the commit you are about to read. Read `README.md` and the `SKILL.md` of each skill you'll use (at least `skills/project-bootstrap/` and `skills/doc-system/`). Then pin to that commit and install:

```bash
git checkout <the commit you wrote down>
```

```bash
./install.sh
```

Git will say you are in "detached HEAD" state. That is expected and fine: it means you're on one fixed commit rather than following the latest changes.

Stay on that commit. Before moving to a newer one, run `git fetch` and read what changed with `git diff <your commit> origin/main`.

## 3. Folders

Make one folder for all your projects, and one folder inside it for the new project. Start Claude Code in the project's folder; it works on the folder it starts in.

```bash
mkdir -p ~/projects/order-desk
```

```bash
cd ~/projects/order-desk
```

```bash
claude
```

Claude Code asks permission before some actions, such as running a command or editing a file. These **permission dialogs** are for you: read what it wants to do and answer yourself. The planning chat can't see them and can't answer them for you. [Permission modes](https://code.claude.com/docs/en/permission-modes) explains how often it asks and how to change that.

## 4. Your first planning chat

1. In Claude.ai, create a Project ([how](https://support.claude.com/en/articles/9519177-how-can-i-create-and-manage-projects)).
2. Start a chat in it and paste the kickoff template, [`skills/project-bootstrap/templates/kickoff-chat.md`](skills/project-bootstrap/templates/kickoff-chat.md), with the [bracketed] parts filled in.
3. Answer every question it asks.
4. Say yes or no to every recommendation. Silence is not a yes: if you skip one, the chat should ask again.

When the questions are settled, the chat drafts your first prompt for Claude Code.

## 5. The first build

Paste the drafted prompt into Claude Code, started in your project folder. It asks Claude Code to set up the repo with the `project-bootstrap` skill. Bootstrap reads the folder, asks the few things it can't work out, shows you every change to a file that already exists before making it, and runs a check that the new docs are in shape. At the end it offers to save everything as a commit and, if there's no GitHub repo yet, to create one.

## 6. After bootstrap

- After bootstrap, it offers to copy the Claude.ai instructions to your clipboard. Say yes, then paste them into the Project's custom instructions: on the Project's page, **Set project instructions**, paste, **Save instructions** ([where that is](https://support.claude.com/en/articles/9519177-how-can-i-create-and-manage-projects)).
- If you need them again later, the file is `.claude/project-instructions.local.md` inside your project. Folders whose names start with a dot are hidden.
- To copy it again, run the line for your system from the project folder:
  - macOS: `pbcopy < .claude/project-instructions.local.md`
  - Windows (PowerShell): `Get-Content -Raw -Encoding utf8 .claude\project-instructions.local.md | Set-Clipboard`
  - Linux: `wl-copy < .claude/project-instructions.local.md`, or on older desktops `xclip -selection clipboard < .claude/project-instructions.local.md`
  - If none of these works (inside WSL, say), open the file in any text editor and copy it from there.
- To see hidden folders: in macOS Finder, press **Cmd+Shift+Period** (press it again to hide them). In Windows File Explorer there is no shortcut: choose **View > Show > Hidden items** ([Microsoft's guide](https://support.microsoft.com/en-us/windows/experience/fileexplorer/file-explorer-in-windows)).
- Then start a fresh chat in the Project, so it starts with the new instructions. After the first push, connect the repo to the Project so the chat can read your docs ([Use the GitHub integration](https://support.claude.com/en/articles/10167454-use-the-github-integration)).

## 7. The loop

1. The planning chat drafts a prompt.
2. You paste it into Claude Code, which builds it.
3. When Claude Code stops with a question, answer build questions (which file, which command) there. Take decisions (what the product should do, what to build next) back to the planning chat.
4. When Claude Code finishes, paste only its final summary back into the planning chat, not the whole session.

## 8. Glossary

- **Repo** (repository): a project folder that git tracks, with its full history of commits.
- **Commit**: a saved snapshot of the repo's files, named by a short code.
- **Pin**: stay on one commit you have read, rather than following the newest changes.
- **Public vs private**: anyone on the internet can read a public repo, forever, including its history; only people you invite can read a private one.
- **Remote**: the copy of your repo on GitHub. **Push** uploads your commits to it.
- **Scheduled CI**: checks GitHub runs on a timer (nightly, say) as a backstop. Your project's `CLAUDE.md` mentions it only if the repo has such a workflow.
- **Doc contract**: a test that checks your project docs keep their shape (the changelog's entries, the spec's index). Claude Code runs it after every change to the docs.
- **Gate**: a check that must pass before work moves on, such as the build or the tests.

For Supabase users:

- **Project ref**: the short code naming your Supabase project, seen in its dashboard address after `/project/`. It isn't a password, but a public repo shouldn't hold it.
- **Owner user ID**: your own account's ID in your app (dashboard: Authentication > Users). The planning chat uses it to count just your data.
- **Read-only vs writable connection**: two ways of linking Supabase to Claude.ai. The read-only one can look but never change anything; the writable one can change data and is kept for Claude Code's careful, undone-afterwards checks. The planning chat uses only the read-only one.
- **Why schema changes are applied by hand**: you paste them into the dashboard's SQL editor yourself. Supabase's push command keeps its own history that conflicts with hand-applied changes, so Claude Code is blocked from running it.
