# Agent orchestration starter

A starter trimmed from a real working setup for Claude Code, Codex CLI and T3 Code.
The main session plans and delegates; role-specific children do
scoped work, and a fresh reviewer checks each review round before commits.
Read it and adapt it rather than installing it blind.

## Roles

| Role | Codex + Claude (default) | Claude only | Codex only |
|---|---|---|---|
| Orchestrator (main session) | Claude Code; either provider in T3 | Claude Code | Codex |
| Workers (implementation, refactors, tests, debugging, scripts, docs, browser, 3D) | `gpt-6.1-sol` at high, run as `codex exec` | `worker` agent, `claude-opus-5-5` at high | `gpt-6.1-sol` at high, `codex exec` |
| Chrome work (Agent Use profile by default) | `gpt-6.1-terra` at medium with Codex's Chrome plugin | `worker` agent with Claude in Chrome | `gpt-6.1-terra` at medium with Codex's Chrome plugin |
| Scouts (read-only research) | `scout` agent, `claude-haiku-5-5` at xhigh | same | `gpt-6.1-terra` at high, read-only `codex exec`, with the `scout` role text |
| Designer | `designer` agent, `claude-opus-5-5` at xhigh | same | `gpt-6.2-astra` at xhigh, `codex exec`, with the `designer` role text |
| Advisors (4 / 2 / 3, all xhigh, all started at once) | `advisor` (`claude-fable-5-2`), `advisor` with `model: opus`, `gpt-6-astra`, `gpt-6.2-astra` | Fable and Opus `advisor` agents | `gpt-6-astra`, `gpt-6.2-astra`, `gpt-6.2-sol` |
| Authoritative reviewer (fresh each round) | Codex `gpt-6.1-sol` at high, `codex exec review`, read-only | `reviewer` agent, `claude-opus-5-5` at xhigh | Codex `gpt-6.1-sol` at high, `codex exec review` |
| Review tiebreak | `gpt-6-astra` at xhigh, read-only | Fable and Opus `advisor` agents | `gpt-6-astra` at xhigh, read-only |

Set `Active setup: Codex + Claude` near the top of [instructions/CLAUDE.md](instructions/CLAUDE.md),
or choose `Claude only` or `Codex only`. Codex only needs a Codex main session.
The launch commands in the table are standalone routes; T3 uses delegated
threads as described below. Authoritative Codex reviews still require the CLI.
Codex + Claude needs both a Claude subscription and authenticated Codex CLI with
access to the listed models. Model names and availability change; use models your plans offer.

## How a task flows

1. The orchestrator scopes the task and sends scouts for prep.
2. Workers build independent parts in parallel. UI features start with a designer.
3. The orchestrator verifies and integrates the results, including real UI flows.
4. `review-fix-loop` uses a fresh reviewer each round. Fixes get affected checks
   and another round until approved within the budget.
5. Commit only approved changes. Push when authorized and ready; let CI run its
   full suites, then merge only when checks are green.

Outside T3, Claude children use Claude Code's Agent tool; Codex children use `codex exec`.
Children do not start more children. Workers run in parallel when independent.
The main session supervises and owns the result.

## Files

- [instructions/CLAUDE.md](instructions/CLAUDE.md): global orchestration and working rules.
- [agents/](agents/): the five role definitions and their model defaults.
- [skills/delegate-work/](skills/delegate-work/SKILL.md): briefs, parallel work, verification and Codex children.
- [T3 reference](skills/delegate-work/references/t3-code.md): delegated threads, workspaces, waits, browser tools and thread cleanup.
- [compute_pool.py](skills/delegate-work/scripts/compute_pool.py): optional read-only Linux/macOS host telemetry.
- [compute-pool.json](skills/delegate-work/config/compute-pool.json): role limits and an empty host list; add only your own authorized hosts.
- [test_compute_pool.py](skills/delegate-work/tests/test_compute_pool.py): telemetry, limits and SSH fixtures without remote access.
- [T3 review runtime](skills/review-fix-loop/references/t3-runtime.md): authoritative review routes and tracked waits.
- [Chrome reference](skills/delegate-work/references/chrome.md): startup, profiles, redaction and tab ownership.
- [open_agent_chrome.py](skills/delegate-work/scripts/open_agent_chrome.py): open a named Chrome profile on Linux or macOS.
- [agent-chrome.mjs](skills/delegate-work/scripts/agent-chrome.mjs): one-call Codex Chrome startup.
- [t3_thread_title.py](skills/delegate-work/scripts/t3_thread_title.py): print the user's T3 thread title, used to name the Chrome tab group.
- [chrome-output.mjs](skills/delegate-work/scripts/chrome-output.mjs): redact browser text and data at the output boundary. Best-effort tidying of what agents print, not a security boundary: unusual formats can slip through.
- [op-login.mjs](skills/delegate-work/scripts/op-login.mjs): fill sign-in locators from a read-only 1Password agent vault without returning credentials.
- [public_suffix_list.dat](skills/delegate-work/scripts/public_suffix_list.dat): pinned public-suffix rules for login domain matching; upstream revision and license are recorded in the file.
- [test_open_agent_chrome.py](skills/delegate-work/tests/test_open_agent_chrome.py): isolated profile-launcher checks.
- [agent-chrome.test.mjs](skills/delegate-work/tests/agent-chrome.test.mjs): startup, profile selection and grouping checks.
- [chrome-output.test.mjs](skills/delegate-work/tests/chrome-output.test.mjs): redaction and runtime-wrapper checks.
- [op-login.test.mjs](skills/delegate-work/tests/op-login.test.mjs): isolated CLI, credential-output and domain-matching checks.
- [skills/review-fix-loop/](skills/review-fix-loop/SKILL.md): bounded review loop, reviewer routes and tree fingerprints.
- [skills/full-send/](skills/full-send/SKILL.md): carry authorized work through publication and checks.
- [skills/full-stop/](skills/full-stop/SKILL.md): prepare and verify a pull request, then leave it open and unmerged.
- [skills/babysit-pr/](skills/babysit-pr/SKILL.md): watch a pull request and handle actionable failures.
- [bin/heavy](bin/heavy): optional gate for finite resource-intensive commands.
- [background_job_guard.py](hooks/background_job_guard.py): Claude Bash detachment check.
- [orchestration_mode.py](hooks/orchestration_mode.py): configured setup at session start.
- [signin_handoff_check.py](hooks/signin_handoff_check.py): optional sign-in handoff nudge.
- [codex-hooks.json](hooks/codex-hooks.json): Codex hook registration template.
- [install_hooks.py](hooks/install_hooks.py): preserve and merge client hook settings.
- Hook regressions: [background jobs](hooks/tests/test_background_job_guard.py), [setup selection](hooks/tests/test_orchestration_mode.py), [sign-in handoffs](hooks/tests/test_signin_handoff_check.py).
- [install.sh](install.sh): symlink installer; [tests/](tests/test_install.py): isolated installer checks.
- [LICENSE](LICENSE): MIT license for this repo.
- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md): attribution and upstream license text.
- [.gitignore](.gitignore): local generated files.

## Install

Requires Bash and Python 3, plus Claude Code for Claude only, Codex CLI for
Codex only, or both for Codex + Claude. Linux and macOS are supported; the
installer uses Bash 3.2-compatible syntax. Choose models available on your plan
before use. Keep this checkout in place: installed files link back to it.

```sh
./install.sh --dry-run
./install.sh --codex
```

Codex + Claude and Codex only use `./install.sh --codex`; Claude only can use
`./install.sh`. The installer always links skills into `~/.claude/skills/`, agent definitions into
`~/.claude/agents/`, and instructions into `~/.claude/CLAUDE.md`. Existing regular
files or directories are renamed to `<path>.bak-<UTC stamp>` (with a counter on
collision). Existing destination symlinks are replaced; their targets are untouched.
Symlinked parent directories are refused. Correct links print `ok` on rerun.
It checks all selected sources before writing. By default it does not edit
`settings.json`; `--with-hooks` and `--t3` merge hook registrations as described below.
Read any existing global instructions and merge rules you need before replacing them.

Whole skill directories are linked, including their references, scripts and
tests. Chrome helpers land in `~/.claude/skills/delegate-work/scripts/`, and
also in `~/.agents/skills/delegate-work/scripts/` with `--codex`; no separate
script installation is needed.

Flags may be combined:

- `--dry-run`: show planned changes without writing anything.
- `--codex`: also link skills into `~/.agents/skills/` and instructions into
  `~/.codex/AGENTS.md`. This does not install Claude's named agents into Codex.
- `--with-hooks`: install and register the optional hooks.
- `--t3`: include `--codex`, `--with-hooks` and T3's default Codex-home instructions/hooks.
- `--with-heavy`: also link `bin/heavy` into `~/.local/bin/heavy`.

Run installer checks with:

```sh
python3 -m unittest discover -s tests
```

Tests use a fixture repo and a throwaway home directory, not your configuration.

## T3 Code

T3 Code runs Claude Code and Codex sessions as threads. The main thread plans
and integrates; `delegate_task` creates child threads with self-contained
briefs. It chooses a provider instance, model and supported options from
`orchestrator_capabilities`, keeping the three setups above. A role label does
not load an agent definition, so briefs include that role's instructions.
Children do their assignment themselves and do not launch more children.

Install the required CLIs and authenticate them, then clone this repo to a
stable location, choose `Active setup` in `instructions/CLAUDE.md` and review
existing global instructions before installing:

```sh
./install.sh --t3 --dry-run
./install.sh --t3
```

This links instructions to `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md` and
`~/.t3/codex-home/AGENTS.md`, skills to `~/.claude/skills/` and
`~/.agents/skills/`, role definitions to `~/.claude/agents/`, and hook scripts
to `~/.claude/hooks/`. It merges registrations into `~/.claude/settings.json`,
`~/.codex/hooks.json` and `~/.t3/codex-home/hooks.json`. If your T3 provider
uses a custom Codex home, merge the same instructions and hook template into
that home too; discover the provider's actual configuration rather than guessing.
T3's Codex home also needs your Codex config and plugins before `@Chrome` works;
see step 3 of [Chrome setup](#chrome-setup).
Restart sessions to load the installed instructions and hooks. The installer
does not install T3, subscriptions, browser integrations or credentials.

Existing configuration keys and hooks are preserved; changed JSON files get
byte-for-byte timestamped backups, and reruns add no duplicate registrations.
Malformed JSON and configuration symlinks are refused before installation;
merge those manually. Dry-run validates and describes changes without writing.
The default non-T3 install is unchanged; `--with-hooks` enables hook wiring
separately, with `--codex` adding the normal Codex home.

The hooks are small checks, not a sandbox:

- `background_job_guard.py` blocks recognized Claude Bash review/worker,
  CI-watch and `heavy` commands detached with shell operators. Use tracked
  Bash background jobs so completion wakes the session. It inspects command
  text and cannot recognize every shell construction.
- `orchestration_mode.py` reports the configured `Active setup` on Claude
  session start (`--status` also works). It makes no network calls, probes no
  accounts and does not infer quota or change setups.
- `signin_handoff_check.py` gives one Stop-hook nudge for likely avoidable
  website handoffs. It is disabled unless the session environment explicitly
  sets `STARTER_SIGNIN_TOOLS=1` after authorized credential tools are connected.
  It is a text heuristic, grants no permission and never fetches credentials.
  Missing tools, ambiguous accounts and human-only challenges still need you.
  It supports Claude and Codex hook payloads; client hook support must be enabled.

Use `isolation: worktree` for a child's separate checkout; T3 prepares it from
the parent's commit and excludes uncommitted edits. Keep shared work limited to
explicit disjoint scopes. Async children wake the parent on completion; follow
returned continuations rather than polling. Tracked CLI work uses the runtime's
background wait (`t3_background_wait` when offered). Authoritative Codex review
stays on the existing local CLI route, with fresh read-only reviewers and stable
fingerprints; delegated advisory reviews cannot approve the review loop.

Use available `pull_request_*` tools for PR operations and `ci_logs`/`ci_rerun`
for checks. Link created, taken-over or pushed PRs with `link_pull_request`
(`pull_request_create` links automatically). The orchestrator uses
`watch_pull_request` while authorized work waits on checks or reviews, then
`unwatch_pull_request` before final handback. Children report status without
watching. Full-stop still never merges, and full-send keeps its merge gate.

For requested browser work, collaborative `preview_*` tools handle local apps
and public pages; they do not inherit your Chrome logins. Real Chrome and
existing tabs use the role table's Chrome worker and the Chrome reference,
after the one-time [Chrome setup](#chrome-setup), including the Agent Use profile.
Requested inline visuals use `html_preview` then `html_render`. Multi-host
placement is optional: the bundled telemetry helper has an empty host list,
configurable role limits and no account or machine provisioning. Keep private
host configuration outside this public checkout with its `--config` option.
See the T3 reference's compute-pool rules before enabling it. New top-level
threads require an explicit request; ordinary delegated work stays in children.
Track task-owned processes and tabs, preserve other sessions and clean up
finished resources. Finished-work and decision replies end with a short Next
list, without a delegated-task inventory.

Read the [T3 reference](skills/delegate-work/references/t3-code.md) for failure
recovery and workspace rules, and [T3 review runtime](skills/review-fix-loop/references/t3-runtime.md)
for review limits. Run the hook checks with:

```sh
python3 -m unittest discover -s hooks/tests
```

## Chrome setup

The installer links the Chrome helpers but not the browser integrations. Do
these steps once yourself. Agents never close or restart Chrome, so the restarts
below are yours.

### 1. Create the Agent Use profile

Create a Chrome profile named `Agent Use` with only the agent extensions:
Codex/ChatGPT, Claude in Chrome, or both for your setup. Install and sign in to
those extensions in that profile, then restart Chrome. Keep an Agent Use window
open so agents can connect. Agents use your personal profile only for tasks that
name a tab there or need your open tabs.

### 2. Connect Claude in Chrome (Claude only or Codex + Claude)

Run `claude` in a terminal, type `/chrome` and enable it, then restart Chrome.
This registers the connector Claude Code uses to reach the extension.

### 3. Give T3's Codex the Chrome plugin (T3 only)

T3 runs Codex with its own home folder, so `@Chrome` and `node_repl` are missing
there until that folder has the Chrome plugin. Install and enable the Chrome
plugin in the Codex or ChatGPT app first, so `~/.codex` has it.

**Find T3's Codex home.** The folder name varies between installs, so read it
from T3's settings rather than assuming one:

```sh
grep -oE '"homePath": ?"[^"]+"' ~/.t3/userdata/settings.json
```

With `jq` installed, `jq -r '.. | .homePath? // empty' ~/.t3/userdata/settings.json`
prints just the path. Set it for the commands below:

```sh
T3_CODEX_HOME="/path/from/homePath"
```

**Recommended: give T3 its own small config.** `~/.codex/config.toml` belongs to
the Codex or ChatGPT app, with its own default model, desktop settings and
plugins, and it may hold API keys: don't print it whole, copy it or share it.
Instead, list only the section headers you need:

```sh
grep -nE '^\[(marketplaces\.openai-bundled|plugins\."chrome@|mcp_servers\.node_repl)' ~/.codex/config.toml
```

Copy those sections, each with the lines under it up to the next header, into
`$T3_CODEX_HOME/config.toml`, creating it if needed. If T3's file already has
one of those headers, add only the missing lines under the existing header;
a header may appear only once in the file. They are usually:

- `[marketplaces.openai-bundled]`: where the bundled plugins come from.
- `[plugins."chrome@openai-bundled"]`: turns the Chrome plugin on.
- `[mcp_servers.node_repl]`: the `node_repl` tool `@Chrome` runs in, with its `command` path.

Then link the plugin folder, so T3 uses the same installed plugin (its `latest`
folder follows app updates). This adds missing links only and never replaces
anything:

```sh
mkdir -p "$T3_CODEX_HOME"
for name in plugins rules; do
  if [ -e "$T3_CODEX_HOME/$name" ] || [ -L "$T3_CODEX_HOME/$name" ]; then
    echo "exists, check by hand: $T3_CODEX_HOME/$name"
  elif [ -e "$HOME/.codex/$name" ]; then
    ln -s "$HOME/.codex/$name" "$T3_CODEX_HOME/$name" && echo "linked $name"
  fi
done
```

If a new T3 Codex thread can't find the `delegate-work` skill, link it in too:

```sh
mkdir -p "$T3_CODEX_HOME/skills"
[ -e "$T3_CODEX_HOME/skills/delegate-work" ] || ln -s "$HOME/.agents/skills/delegate-work" "$T3_CODEX_HOME/skills/delegate-work"
```

**Alternative: share one config.** If you'd rather T3 use exactly your Codex
setup, link `config.toml`, `plugins`, `skills`, `rules`, `AGENTS.md` and
`hooks.json` from `~/.codex` into `$T3_CODEX_HOME` instead, again only where
nothing exists yet. The trade-off: T3 then gets the app's default model,
reasoning effort and every plugin, and both apps write to the same file.

`./install.sh --t3` writes `AGENTS.md` and `hooks.json` only into
`~/.t3/codex-home`. If your `homePath` is different, link or merge those two
there as well. Open a new T3 thread afterwards; threads that are already open
keep the old setup. Chrome's Codex connector works without the ChatGPT desktop
app running.

### 4. Optional: 1Password for agent sign-ins

1. Create an agent vault, for example `Agentes`. Move, rather than copy, the
   logins agents may use into it: each password lives once and edits sync
   everywhere. The built-in Personal/Private vault can never be shared with a
   service account, so logins left there stay invisible to agents. To move
   many at once in 1Password, filter the private vault to the Login category,
   select all and move them; cards, documents and notes are other categories
   and stay behind. Then move back any logins you want to keep from agents
   (for example banks, your main email and the 1Password login). Agents match
   logins by website, so give each moved login its site URL.
2. In 1Password, open **Developer > Directory > Service account** and create
   an account with **read items only**, limited to the agent vault. Service
   accounts work on Individual plans and cannot access Personal/Private vaults.
3. Install `op` from [1Password's official zip](https://developer.1password.com/docs/cli/get-started/)
   and [verify its signature](https://developer.1password.com/docs/cli/verify-downloads/).
   Check the signing-key fingerprint:
   `3FEF 9748 469A DBE1 5DA7 CA80 AC2D 6274 2012 EA22`.
   Alternatively, use 1Password's official apt repository. Put `op` on PATH or
   in `~/.local/bin`.
4. Save the service account token to `~/.config/op-agentes/token`, with directory
   mode 0700 and file mode 0600. Use a local editor or a hidden-input prompt;
   never paste the token into chat, shell history or repo files. If you also
   save it in 1Password, keep that copy in your private vault, not the agent vault.
5. Keep the 1Password browser extension out of the `Agent Use` profile, so the
   browser worker cannot access the full account. Verify the restricted CLI
   access without printing the token:

   ```sh
   OP_SERVICE_ACCOUNT_TOKEN="$(cat ~/.config/op-agentes/token)" op vault list
   ```

   The list must show only the agent vault.

Chrome workers then use the [1Password sign-in helper](skills/delegate-work/references/chrome.md#signing-in-with-1password).
The helper reads the token per call and sends values directly into form
locators; credentials never become helper output. No extension is required.

### Opening the profile

Open the Agent Use profile manually, or run the installed opener:

```sh
python3 ~/.agents/skills/delegate-work/scripts/open_agent_chrome.py
```

For Claude only, use `~/.claude/skills/delegate-work/scripts/open_agent_chrome.py`
instead. `--name 'Custom profile'` selects another configured profile name.
The Codex startup helper opens the requested profile automatically when it
is disconnected; if its runtime cannot spawn processes, run the opener in the shell.
See the [Chrome quick start](skills/delegate-work/references/chrome.md), including
custom profile names and the default Codex plugin path. The Codex helper needs
Node.js and the Chrome plugin's `node_repl` tool; Claude only uses Claude in Chrome.

Run the Chrome helper checks with:

```sh
python3 -m unittest discover -s skills/delegate-work/tests
node --test skills/delegate-work/tests/*.test.mjs
```

## Website sign-ins

Credential tools are optional and are not bundled. Explicitly connect a password
manager or email tool for agent sign-ins if you want the browser worker to sign in itself;
it may use them for signing in only, within your approval and the tool's rules.
Otherwise it asks you to sign in. Passwords and codes go straight into forms,
never chat, reports, briefs, files, commits or memory. Ambiguous accounts and
tool refusals or failures stop the sign-in.

For 1Password, follow [Chrome setup step 4](#4-optional-1password-for-agent-sign-ins).

Agents complete simple human checks, such as a checkbox or press-and-hold, and
never use CAPTCHA-solving services. Image, audio or puzzle challenges need you.
For two-factor prompts, they check alternative methods and use only one you
have authorized and equipped them to complete. For provider sign-ins, they use
only the provider and account named by your saved login; they continue through
a consent screen that asks only for basic sign-in info and stop for anything
more. They accept updated terms-of-service dialogs (required agreement only,
optional choices off) and reject non-essential cookies. Creating accounts, changing passwords or account settings, purchases,
messages and posts still need your approval in chat. See the full
[Website sign-ins rules](instructions/CLAUDE.md#website-sign-ins).

## Adapt it

Give your agent this prompt:

> Read this repo, ask me which tools, models and subscriptions I have, choose
> Codex + Claude, Claude only or Codex only, then adapt the role split and review loop.

Start small: one worker, a read-only scout, and a fresh reviewer before commits.
Add rules when real problems show up. Keep project-specific requirements in each
project, and remove integrations you do not use.

Change `model` and `effort` in [agents/](agents/) for Claude children and the
[Codex role defaults](skills/delegate-work/references/codex-workers.md) for Codex children
to fit your plans. Update the role table and instruction defaults to match.
The Opus second advisor uses the Agent tool's `model: opus` override.
Model availability and supported effort settings can change; confirm them locally.
Use narrow briefs and small research inputs to keep subscription usage predictable.

See [Codex children](skills/delegate-work/references/codex-workers.md) for workers,
scouts, designers and advisors, and [Codex review](skills/review-fix-loop/references/codex-reviewer.md)
for authoritative reviews. Installing `--codex` makes skills discoverable;
it does not give Codex Claude Code's Agent or SendMessage tools. Outside T3, in Codex only,
every role is a `codex exec` child; no Claude children run. In T3 use the
[T3 reference](skills/delegate-work/references/t3-code.md) for delegated roles.

If installed, use `~/.local/bin/heavy <command> ...` for full suites, builds and
whole-project type checks. Focused tests and development servers run directly.
It is a command gate, not a sandbox; see [bin/heavy](bin/heavy) for its limits.

## Credits

`full-send`, `full-stop` and `babysit-pr` are adapted from
[t3dotgg/tstack](https://github.com/t3dotgg/tstack), MIT.
See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

MIT. See [LICENSE](LICENSE).
