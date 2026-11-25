import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { installChromeRedaction, redact } from './chrome-output.mjs';

const opener = fileURLToPath(new URL('./open_agent_chrome.py', import.meta.url));
const MANUAL_OPEN = 'Chrome profile is not connected. Run python3 ~/.agents/skills/delegate-work/scripts/open_agent_chrome.py (with --name for a custom profile), then call startAgentChrome again.';
const SANDBOXED = 'Chrome profile is not connected and this sandboxed session cannot start Chrome. Stop and ask the orchestrator to run python3 ~/.agents/skills/delegate-work/scripts/open_agent_chrome.py from its own shell (with --name for a custom profile).';
const SANDBOX_EXIT = 3; // open_agent_chrome.py's exit code for a sandboxed session

async function openProfile(profile) {
  // Dynamic import: some node_repl runtimes forbid child_process. No shell. The
  // starter replaces any failure with a fixed message, so no subprocess output
  // or error crosses the public boundary.
  const { execFile } = await import('node:child_process');
  await new Promise((resolve, reject) => execFile('python3', [opener, '--name', profile],
    { timeout: 10000, maxBuffer: 16384 }, error => error ? reject(error) : resolve()));
}

async function groupNewTab(browser, tab, sessionName, say) {
  try {
    const management = await browser.capabilities.get('management');
    const info = (await browser.tabs.list()).find(info => info.id === tab.id);
    const provider = JSON.parse(info.providerTabId);
    const id = Array.isArray(provider) && provider.length === 2 ? Number(provider[1]) : NaN;
    if (!Number.isSafeInteger(id)) throw new Error('Unsupported tab identity');
    const row = (await management.tabs.query({})).find(row => row.id === id);
    if (!row || row.url !== info.url || row.title !== info.title) throw new Error('Tab identity changed');
    // tabs.new already joins the plugin's session group. Never modify an
    // existing group; create/name one only if the new tab is ungrouped.
    if (row.groupId !== -1) return;
    const groupId = await management.tabs.group({ tabIds: [id] });
    await management.tabGroups.update(groupId, { title: sessionName });
  } catch {
    try { say('Chrome tab grouping failed; continuing in this tab.'); } catch { /* best effort reporting */ }
  }
}

// Dependency injection keeps setup testable without loading Chrome or spawning
// a process. The normal entrypoint below always uses the real runtime.
export function createAgentChromeStarter({ runtime = () => globalThis.nodeRepl,
  loadRuntime = () => import(`${homedir()}/.codex/plugins/cache/openai-bundled/chrome/latest/scripts/browser-client.mjs`),
  open = openProfile, wait = delay, now = () => performance.now(), pollTimeoutMs = 60000 } = {}) {
  return async function startAgentChrome({ url, sessionName, profile = 'Agent Use', forUser = false, log } = {}) {
    if (typeof sessionName !== 'string' || !sessionName.trim() || typeof profile !== 'string' || !profile.trim())
      throw new Error('Provide a sessionName and a Chrome profile name.');
    const timings = {};
    const started = now();
    const phase = async (name, action) => {
      const before = now();
      try { return await action(); } finally { timings[name] = Math.max(0, now() - before); }
    };
    const output = await phase('redaction', () => installChromeRedaction(runtime()));
    const say = log ? (...values) => log(...values.map(value => redact(value))) : output.say;
    const agent = await phase('runtime', async () => (await loadRuntime()).setupBrowserRuntime());
    const select = rows => rows.find(row => row.type === 'extension' && row.family === 'chrome' && row.profileName === profile);
    let info = await phase('list', async () => select(await agent.browsers.list()));
    timings.openProfile = 0;
    timings.connect = 0;
    if (!info) {
      await phase('openProfile', async () => {
        try { await open(profile); } catch (error) { throw new Error(error?.code === SANDBOX_EXIT ? SANDBOXED : MANUAL_OPEN); }
      });
      info = await phase('connect', async () => {
        const deadline = now() + pollTimeoutMs;
        do {
          const found = select(await agent.browsers.list());
          if (found) return found;
          const remaining = deadline - now();
          if (remaining <= 0) break;
          await wait(Math.min(250, remaining));
        } while (true);
        throw new Error(MANUAL_OPEN);
      });
    }
    const browser = await phase('browser', () => agent.browsers.get(info.id));
    await phase('session', () => browser.nameSession(sessionName));
    const tab = await phase('tab', () => browser.tabs.new());
    // The plugin closes unmarked tabs when the turn ends. A page the user must
    // act on is marked as handed off, so it stays open, in the background: the
    // plugin can neither select a tab nor raise its window.
    if (forUser) await phase('handoff', async () => {
      try { await tab.markHandoff(); } catch {
        try { say('Could not keep this tab open for the user; call tab.markHandoff() before the turn ends.'); } catch { /* best effort reporting */ }
      }
    });
    await phase('group', () => groupNewTab(browser, tab, sessionName, say));
    await phase('navigate', async () => { if (url !== undefined) await tab.goto(url); });
    timings.total = Math.max(0, now() - started);
    return { agent, browser, tab, say, redact, timings, nodeRepl: output.nodeRepl };
  };
}

export const startAgentChrome = createAgentChromeStarter();
