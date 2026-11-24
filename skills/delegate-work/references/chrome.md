# Quick start

Use Codex's Chrome plugin through `node_repl`'s `js` tool. First declare bindings
at top level in their own call:

```js
var startAgentChrome = null;
var agent = null, browser = null, tab = null, say = null, redact = null, timings = null, chromeRepl = null;
```

Import in the next call, then run startup alone in another call:

```js
({ startAgentChrome } = await import((await import('node:os')).homedir() + '/.agents/skills/delegate-work/scripts/agent-chrome.mjs'));
```

```js
({ agent, browser, tab, say, redact, timings, nodeRepl: chromeRepl } = await startAgentChrome({
  url: 'https://example.org', sessionName: 'Research task',
}));
```

`chromeRepl` is the redacting wrapper; keep the runtime global intact.
Use a URL from the brief. Pass the session name the brief gives as `sessionName`,
unchanged: it titles the Chrome tab group, and in T3 it is the title of the
thread that asked for the work, so the user can tell which thread owns each
group. Only when the brief gives none, use a short task name.
A throwing call keeps no new declarations; initialize
`var x = null;` in one call and assign it in another. Do not hide bindings inside
`try` blocks or combine startup with later actions that may fail.

Work in `Agent Use`, a dedicated Chrome profile with only the agent extensions,
so password-manager pop-ups and ad blockers do not obstruct automation.
Use the user's own profile only when the brief names a tab there or needs their
open tabs. `startAgentChrome({ profile: 'Custom profile', sessionName: 'Task' })`
selects a custom name. Report the profile used.

Read a snapshot first, then use its exact role and name for actions:

```js
say(await tab.playwright.domSnapshot());
```

```js
await tab.playwright.getByRole('button', { name: 'Name from snapshot', exact: true }).click();
say(await tab.playwright.domSnapshot());
```

Use `say(value)` for all text/data output, including URLs, tab lists and errors.
Never print handles or form values. Close only tabs you created:

```js
await tab.close();
```

## Connection and setup

The helper installs redaction, selects only the requested Chrome extension
profile, names the session, opens and groups a new tab, then navigates. It returns
phase timings in milliseconds. It never scans the user's tabs or substitutes
another profile. Existing session groups are left alone; grouping failures are
reported without stopping startup.

A profile's extension connects only while that profile has a window open. The
helper opens that window if needed and waits briefly for connection. If spawning
is unavailable, run this in the shell, then call startup again:

```sh
python3 ~/.agents/skills/delegate-work/scripts/open_agent_chrome.py
```

Use `--name 'Custom profile'` to choose a name or `--print-dir` to inspect its
directory without opening Chrome. A missing or duplicate name exits 2: create
or select the agent profile, rather than guessing. The opener supports Linux
(`google-chrome`) and macOS (`Google Chrome`). It never closes or restarts Chrome.

The default Codex plugin module is
`~/.codex/plugins/cache/openai-bundled/chrome/latest/scripts/browser-client.mjs`.
Plugin layouts vary; check your installation if that path is absent. In T3,
Codex uses its own home (`homePath` in T3's settings); when `node_repl` or
`@Chrome` is missing there, report it and point to step 3 of the README's
Chrome setup rather than editing that home yourself. To supply
another path, import `createAgentChromeStarter` from the same helper and pass
`{ loadRuntime: () => import('/path/to/browser-client.mjs') }` when creating it.
Keep helper imports together; they resolve relative to their installed skill.
The installer links this directory into `~/.agents/skills/delegate-work/` with
`--codex`, and always into `~/.claude/skills/delegate-work/`.

In Claude only, use Claude in Chrome and run the opener from
`~/.claude/skills/delegate-work/scripts/open_agent_chrome.py` before connecting.
Keep its Agent Use window open. If the tool cannot identify the profile it
controls, report the ambiguity; never close other windows to force selection.
The Node startup helper is for Codex's plugin.

## Signing in with 1Password

When the user has configured the agent vault token (README, Chrome setup step
4), check the vault with `op-login.mjs` in the same Node REPL before asking the
user to sign in. Use a matching login; ask the user through the orchestrator
only when no login matches, several match, or the helper refuses. Declare
bindings in one call:

```js
var listLogins = null, fillLogin = null, fillOtp = null, logins = null, login = null, url = null;
```

Import in a separate call:

```js
({ listLogins, fillLogin, fillOtp } = await import((await import('node:os')).homedir() + '/.agents/skills/delegate-work/scripts/op-login.mjs'));
```

Call `listLogins({ url })` with the current page URL from the browser. It returns
only `{ id, title, urls }`, with hostnames in `urls`; matching uses registrable
domains, including private suffixes:

```js
url = (await browser.tabs.list()).find(info => info.id === tab.id).url;
logins = await listLogins({ url });
say(logins);
```

Pick the login by exact title or an unambiguous host match; ask the orchestrator
if ambiguous. Read a fresh snapshot
and use its exact locator names. For example, after selecting `login` from
`logins` and confirming these field names:

```js
await fillLogin({
  username: tab.playwright.getByRole('textbox', { name: 'Username', exact: true }),
  password: tab.playwright.getByRole('textbox', { name: 'Password', exact: true }),
}, { item: login });
```

Either locator can be omitted for two-step pages. Submit using the page's
button, then continue from a fresh snapshot. If the saved login has TOTP, use
`await fillOtp(locator, { item: login })` with the current code-field locator.
The fill helpers return only success flags; never read values out of the form
or print them with `say`, `console`, implicit returns or any other output.
They verify each field's own document URL against the saved login's domain
before reading credentials and again before filling, and refuse non-HTTPS pages or mismatches.

The helper defaults to `~/.config/op-agentes/token`, vault `Agentes`, and `op`
from PATH or `~/.local/bin`. Overrides are `OP_AGENT_TOKEN_FILE`,
`OP_AGENT_VAULT` and `OP_BIN`. It requires a token file with mode 0600 and passes
the token only through the CLI's environment. If the token file is absent,
follow the existing sign-in rules and ask the user to sign in. Stop on other
credential-tool failures or missing logins; do not guess or retry refusals.

## Output boundary

`say` redacts URL query values, fragments, credentials, obvious token strings
and secret object fields. Raw browser handles and navigation URLs stay intact
inside the REPL. The returned wrapper (`chromeRepl.write` in the quick start)
also redacts when a shadow can be installed; the runtime global is unchanged.
Always prefer `say`. Redaction is best effort, not a security boundary: still
never type passwords, codes or keys into chat or reports yourself.

This is an obvious-token filter, not a general personal-data scrubber. Implicit
returns, `console`, plugin-owned output such as `ax.write()`, and screenshots
are outside the boundary. Do not expose sensitive page content through them.
Other runtime methods, including image emits, are forwarded unchanged.

## Existing tabs and pitfalls

For an assigned existing tab, set up the plugin runtime without calling
`startAgentChrome` (which always opens a new tab): import the plugin's
`setupBrowserRuntime`, call it, then list browsers through `say`. Install
`installChromeRedaction(globalThis.nodeRepl)` from the installed
`~/.agents/skills/delegate-work/scripts/chrome-output.mjs` first, using the
import pattern in the quick start. Select the returned
Chrome extension browser by its exact `profileName`, then use its returned ID
with `agent.browsers.get`. Name the session with `browser.nameSession`, using
the brief's session name, before claiming anything.

Scan `browser.user.openTabs()` only for the task's assigned tabs. Match the
exact title and URL, then pass that returned object to `browser.user.claimTab`.
Never guess IDs, take a similar tab, or bypass a claim refusal. If the named tab
is absent or unavailable, report it. Leave the user's groups intact.

Read the claimed tab's snapshot before navigating. Preserve drafts and unsaved
input; open your own tab when leaving is uncertain. Never reload an exact URL
match or navigate away to test whether a draft is safe. A missing unload dialog
does not establish safety. After each action, inspect a fresh snapshot; AX
indices also need a fresh state. Close your own temporary tabs when finished,
and leave claimed user tabs open. Follow the global Website sign-ins rules.
