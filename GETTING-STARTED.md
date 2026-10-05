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

### The `claude` command

The Claude desktop app does not put a `claude` command in your terminal, and some steps below need one (section 7, and checking permission rules). Install it with the command from [Claude Code setup](https://code.claude.com/docs/en/setup). On macOS or Linux:

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

On Windows, in PowerShell, the setup page gives `irm https://claude.ai/install.ps1 | iex`. This command has not been tested here. Then open a new terminal window and run `claude --version`.

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

One question is whether the app is for many people, each with their own account, or just for you. Answer it plainly: only for many people does the planning chat weigh every feature against heavy use by many accounts at once.

## 6. After bootstrap

- After bootstrap, it offers to copy the Claude.ai instructions to your clipboard. Say yes, then paste them into the Project's custom instructions: on the Project's page, **Set project instructions**, paste, **Save instructions** ([where that is](https://support.claude.com/en/articles/9519177-how-can-i-create-and-manage-projects)).
- If you need them again later, the file is `.claude/project-instructions.local.md` inside your project. Folders whose names start with a dot are hidden.
- To copy it again, run the line for your system from the project folder:
  - macOS: `pbcopy < .claude/project-instructions.local.md`
  - Windows (PowerShell): `Get-Content -Raw -Encoding utf8 .claude\project-instructions.local.md | Set-Clipboard`. This command has not been tested on Windows; if it fails, use the text-editor route below.
  - Linux: `wl-copy < .claude/project-instructions.local.md`, or on older desktops `xclip -selection clipboard < .claude/project-instructions.local.md`
  - If none of these works (inside WSL, say), open the file in any text editor and copy it from there.
- To see hidden folders: in macOS Finder, press **Cmd+Shift+Period** (press it again to hide them). In Windows File Explorer there is no shortcut: choose **View > Show > Hidden items** ([Microsoft's guide](https://support.microsoft.com/en-us/windows/experience/fileexplorer/file-explorer-in-windows)).
- Bootstrap writes deny rules into `.claude/settings.json`: Claude Code may not force-push or delete branches on GitHub, and for Supabase projects may not run `supabase db push`. To see them, start `claude` in a terminal in the project folder and type `/permissions`. In the desktop app's Code tab, `/permissions` opens a mode picker instead of the rule list.
- Those rules cover only the usual ways of typing those commands. Bootstrap also installs a **pre-push hook**, `.githooks/pre-push`: before any push leaves your computer, git runs it, and it refuses to delete a branch on GitHub or to overwrite commits there (a force push), including most ways of typing the command that those rules miss. It's switched on per copy of the repo, so after cloning the repo anywhere else, run `git config core.hooksPath .githooks` in its folder once. If you ever truly mean to force-push, run `git push --force --no-verify` yourself in a terminal; Claude Code is blocked from doing that.
- On GitHub, a ruleset that blocks force pushes and deletion protects your main branch for every client ([creating rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository)). Rulesets are available for public repos, and for private repos on a paid plan. On the free plan a private repo can't have one ([GitHub's plans](https://docs.github.com/en/get-started/learning-about-github/githubs-plans)), so there the hook is what protects it.
- Then start a fresh chat in the Project, so it starts with the new instructions. After the first push, connect the repo to the Project so the chat can read your docs ([Use the GitHub integration](https://support.claude.com/en/articles/10167454-use-the-github-integration)).

## 7. Supabase connectors (Supabase users only)

A **connector** lets Claude reach your Supabase project. Each project needs its own pair, each tied to that one project. Skip this until the Supabase project exists; bootstrap asks whether the pair is set up and, if not, gives you these same steps (with your project's ID filled in when the repo is private). Your project's ID is the short code after `/project/` in the Supabase dashboard's address; below it is written `<ref>`.

Build each address by hand as shown, and don't use the Supabase dashboard's one-click Claude.ai install: it hides the address, so you can't see what the connector can reach. In each address, `project_ref=` ties it to one project, `read_only=true` lets it only read, and `features=` turns on only the tool groups listed.

1. **Read-only, in Claude.ai**, for planning chats ([Claude's help page on custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)):
   - Go to **Customize > Connectors**, click **+ Add**, then **Add custom connector**. On a Team or Enterprise plan, an owner adds it under **Organization settings > Connectors**, and you then click **Connect** under **Customize > Connectors**.
   - Name it after the project, such as `Supabase order-desk read-only`.
   - For the server URL, enter `https://mcp.supabase.com/mcp?project_ref=<ref>&read_only=true&features=database,debugging,functions,docs`.
   - Keep the default sign-in settings, and sign in to Supabase when asked.
2. **Writable, in Claude Code**, from the project's folder ([Supabase's MCP guide](https://supabase.com/docs/guides/getting-started/mcp), [Claude Code's MCP guide](https://code.claude.com/docs/en/mcp)). Replace `<ref>` before running it:

   ```bash
   claude mcp add --transport http supabase-order-desk-rw --scope local "https://mcp.supabase.com/mcp?project_ref=<ref>&features=database,debugging,functions,docs,development"
   ```

   Then start `claude` in that folder, type `/mcp`, choose `supabase-order-desk-rw`, and choose Authenticate. `--scope local` keeps it out of your repo and out of your other projects. If you apply database changes yourself, bootstrap blocks this connector's `apply_migration` tool by this exact name, so keep the name, or change the rule in `.claude/settings.json` to match.
3. Ask Claude Code to regenerate the Claude.ai instructions with the two names, then paste them into the Project again.

Connectors you add in Claude.ai, from every project, show up in every chat and every Claude Code session on your account. The regenerated instructions name this project's pair and tell Claude never to use any other.

Never add the writable one in Claude.ai, or with `--scope project`, and never use one that reaches every project in your account. Supabase's own guide shows `--scope project`, which writes a `.mcp.json` file into your repo; once committed, that file hands the writable connector to every session that opens the repo, on every computer that clones it.

## 8. Running more than one project

- Give each project its own folder, and start Claude Code in that project's own folder. A session works on the folder it starts in, and a writable connector added with `--scope local` loads only there.
- Give each project its own connector pair, named after the project. Every connector you add in Claude.ai is listed in every chat and every Claude Code session on your account, so in a planning chat turn on only that project's read-only one: **+ > Connectors** in the chat.
- Each project's `CLAUDE.md` tells its sessions to leave alone any process, file, database or deploy they can't tie to their own repo, since another project's session may be running at the same time.

## 9. The loop

1. The planning chat drafts a prompt.
2. You paste it into Claude Code, which builds it.
3. When Claude Code stops with a question, answer build questions (which file, which command) there. Take decisions (what the product should do, what to build next) back to the planning chat.
4. When Claude Code finishes, paste only its final summary back into the planning chat, not the whole session.

## 10. Glossary

- **Repo** (repository): a project folder that git tracks, with its full history of commits.
- **Commit**: a saved snapshot of the repo's files, named by a short code.
- **Pin**: stay on one commit you have read, rather than following the newest changes.
- **Public vs private**: anyone on the internet can read a public repo, forever, including its history; only people you invite can read a private one.
- **Remote**: the copy of your repo on GitHub. **Push** uploads your commits to it.
- **Scheduled CI**: checks GitHub runs on a timer (nightly, say) as a backstop. Your project's `CLAUDE.md` mentions it only if the repo has such a workflow.
- **Doc contract**: a test that checks your project docs keep their shape (the changelog's entries, the spec's index) and that no template blank was left unfilled. Claude Code runs it after every change to the docs.
- **Gate**: a check that must pass before work moves on, such as the build or the tests.

For Supabase users:

- **Project ref**: the short code naming your Supabase project, seen in its dashboard address after `/project/`. It isn't a password, but a public repo shouldn't hold it.
- **Owner user ID**: your own account's ID in your app (dashboard: Authentication > Users). The planning chat uses it to count just your data.
- **Read-only vs writable connector**: the two links between Claude and one Supabase project (section 7). The read-only one, in Claude.ai, can look but not change data; the writable one, in Claude Code only, can change data and is kept for Claude Code's careful, undone-afterwards checks. The planning chat uses only the read-only one.
- **Why schema changes are applied by hand**: you paste them into the dashboard's SQL editor yourself. Supabase's push command keeps its own history that conflicts with hand-applied changes, so Claude Code is blocked from running it.
