import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentChromeStarter } from '../scripts/agent-chrome.mjs';

const agentProfile = { id: 'agents', type: 'extension', family: 'chrome', profileName: 'Agent Use' };
const otherProfiles = [
  { ...agentProfile, id: 'user', profileName: 'Personal' },
  { ...agentProfile, id: 'cdp', type: 'cdp' },
  { ...agentProfile, id: 'edge', family: 'edge' },
];

function fixture({ lists = [[...otherProfiles, agentProfile]], grouped = false, groupFails = false, openFails = false, openError, handoffFails = false } = {}) {
  let clock = 0, calls = 0;
  const events = [], output = [];
  const tab = {
    id: 'opaque-tab',
    goto: async url => events.push(['goto', url]),
    markHandoff: async () => { if (handoffFails) throw new Error('lease refused'); events.push(['handoff']); },
  };
  const management = {
    tabs: {
      query: async () => [{ id: 42, groupId: grouped ? 7 : -1, url: 'about:blank', title: 'New Tab' }],
      group: async value => { events.push(['group', value]); return 7; },
    },
    tabGroups: { update: async (...args) => events.push(['groupTitle', ...args]) },
  };
  const browser = {
    nameSession: async name => events.push(['session', name]),
    tabs: {
      new: async () => { events.push(['new']); return tab; },
      list: async () => [{ id: tab.id, providerTabId: '["instance",42]', url: 'about:blank', title: 'New Tab' }],
    },
    capabilities: { get: async name => {
      assert.equal(name, 'management');
      if (groupFails) throw new Error('group policy refused');
      return management;
    } },
    user: { openTabs: () => assert.fail('Must never scan user tabs') },
  };
  const agent = { browsers: {
    list: async () => lists[Math.min(calls++, lists.length - 1)],
    get: async id => { events.push(['get', id]); return browser; },
  } };
  const start = createAgentChromeStarter({
    runtime: () => Object.freeze({ write: value => output.push(value) }),
    loadRuntime: async () => ({ setupBrowserRuntime: async () => agent }),
    open: async profile => {
      events.push(['open', profile]);
      if (openError) throw openError;
      if (openFails) throw new Error('Run the profile opener from the shell');
    },
    now: () => ++clock,
    wait: async ms => { clock += ms; },
    pollTimeoutMs: 500,
  });
  return { start, events, output, browser, tab, agent };
}

test('selects exactly the Chrome extension/profile and names session before opening', async () => {
  const f = fixture();
  const result = await f.start({ url: 'https://example.com', sessionName: '🔎 Test' });
  assert.equal(result.agent, f.agent);
  assert.equal(result.browser, f.browser);
  assert.equal(result.tab, f.tab);
  assert.deepEqual(f.events, [
    ['get', 'agents'], ['session', '🔎 Test'], ['new'],
    ['group', { tabIds: [42] }], ['groupTitle', 7, { title: '🔎 Test' }], ['goto', 'https://example.com'],
  ]);
  assert.deepEqual(Object.keys(result.timings), ['redaction', 'runtime', 'list', 'openProfile', 'connect', 'browser', 'session', 'tab', 'group', 'navigate', 'total']);
  assert.ok(Object.values(result.timings).every(ms => Number.isFinite(ms) && ms >= 0));
  assert.ok(result.timings.total >= result.timings.runtime);
  result.say('https://example.com/?token=private-secret');
  assert.ok(!f.output[0].includes('private-secret'));
  result.nodeRepl.write({ password: 'also-private' });
  assert.deepEqual(f.output[1], { password: '<redacted>' });
});

test('opens missing profile and polls until its extension connects', async () => {
  const f = fixture({ lists: [otherProfiles, otherProfiles, [agentProfile]], grouped: true });
  const result = await f.start({ sessionName: 'Test' });
  assert.deepEqual(f.events[0], ['open', 'Agent Use']);
  assert.ok(result.timings.openProfile > 0);
  assert.ok(result.timings.connect >= 250);
  assert.ok(!f.events.some(([name]) => ['group', 'groupTitle', 'goto'].includes(name)));
});

test('custom profile is selected without touching the default profile', async () => {
  const f = fixture();
  await f.start({ sessionName: 'Assigned user tab task', profile: 'Personal' });
  assert.deepEqual(f.events[0], ['get', 'user']);
});

test('spawning unavailable reports manual opener and never touches another profile', async () => {
  const f = fixture({ lists: [otherProfiles], openFails: true });
  await assert.rejects(f.start({ sessionName: 'Test' }), /Run python3.*open_agent_chrome/);
  assert.deepEqual(f.events, [['open', 'Agent Use']]);
});

test('connection wait has a deadline and never substitutes a user profile', async () => {
  const f = fixture({ lists: [otherProfiles] });
  await assert.rejects(f.start({ sessionName: 'Test' }), /Run python3.*open_agent_chrome/);
  assert.deepEqual(f.events, [['open', 'Agent Use']]);
});

test('grouping refusal is tolerated and log output is redacted', async () => {
  const f = fixture({ groupFails: true });
  const logged = [];
  const result = await f.start({ url: 'https://example.com', sessionName: 'Test', log: value => logged.push(value) });
  assert.equal(result.tab, f.tab);
  assert.deepEqual(f.events.at(-1), ['goto', 'https://example.com']);
  assert.match(logged[0], /grouping failed/);
  result.say({ token: 'private' });
  assert.deepEqual(logged[1], { token: '<redacted>' });
});

test('grouping warning cannot fail startup even when the caller logger throws', async () => {
  const f = fixture({ groupFails: true });
  const result = await f.start({ sessionName: 'Test', log: () => { throw new Error('logger failed'); } });
  assert.equal(result.tab, f.tab);
});

test('forUser marks the new tab as handed off before navigating', async () => {
  const f = fixture({ grouped: true });
  const result = await f.start({ url: 'https://example.com', sessionName: 'Test', forUser: true });
  assert.deepEqual(f.events, [['get', 'agents'], ['session', 'Test'], ['new'], ['handoff'], ['goto', 'https://example.com']]);
  assert.ok(result.timings.handoff >= 0);
});

test('handoff refusal is reported without stopping startup', async () => {
  const f = fixture({ grouped: true, handoffFails: true });
  const logged = [];
  const result = await f.start({ sessionName: 'Test', forUser: true, log: value => logged.push(value) });
  assert.equal(result.tab, f.tab);
  assert.match(logged[0], /markHandoff/);
});

test('sandboxed opener exit sends the worker to the orchestrator without subprocess details', async () => {
  const f = fixture({ lists: [otherProfiles], openError: Object.assign(new Error('private subprocess output'), { code: 3 }) });
  await assert.rejects(f.start({ sessionName: 'Test' }),
    error => /sandboxed session.*ask the orchestrator/.test(error.message) && !error.message.includes('private'));
  assert.deepEqual(f.events, [['open', 'Agent Use']]);
});
