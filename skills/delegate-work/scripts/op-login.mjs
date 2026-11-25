import { constants } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';

// Only fixed messages cross the public boundary, including locator failures:
// both op and Playwright errors can contain credentials or command output.
class LoginError extends Error {}
async function safe(action, stage) {
  try { return await action(); } catch (error) {
    throw new Error(error instanceof LoginError ? error.message : `1Password sign-in failed while ${stage}; no credential details were returned.`);
  }
}

// node_repl modules have no process global. Keep overrides in ordinary Node,
// and give op its required HOME when running with the restricted REPL globals.
const runtimeEnv = () => typeof process === 'undefined' ? { HOME: homedir() } : process.env;

async function tokenFromFile() {
  const configured = runtimeEnv().OP_AGENT_TOKEN_FILE;
  const path = configured?.startsWith('~/') ? join(homedir(), configured.slice(2))
    : configured || join(homedir(), '.config/op-agentes/token');
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (!stat.isFile()) throw new LoginError('1Password token path must be a regular file.');
    if ((stat.mode & 0o777) !== 0o600)
      throw new LoginError('1Password token file must have mode 0600 (owner read/write only).');
    const token = (await file.readFile('utf8')).trim();
    if (!token) throw new LoginError('1Password token file is empty.');
    return token;
  } catch (error) {
    if (error instanceof LoginError) throw error;
    throw new LoginError('1Password token file is missing or unreadable; ask the user to sign in.');
  } finally { await file?.close(); }
}

async function runOp(args) {
  const token = await tokenFromFile();
  try {
    // Import lazily: some node_repl runtimes cannot spawn subprocesses.
    const { execFile } = await import('node:child_process');
    const env = runtimeEnv();
    return await new Promise((resolve, reject) => execFile(env.OP_BIN || 'op', args, {
      env: { ...env, PATH: [env.PATH, join(homedir(), '.local/bin')].filter(Boolean).join(delimiter),
        OP_SERVICE_ACCOUNT_TOKEN: token },
      timeout: 15000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8',
    }, (error, stdout, stderr) => {
      if (!error) return resolve(stdout);
      // Never propagate stderr, stdout, error.message or the child error object.
      let message = '1Password CLI failed; check the agent vault configuration.';
      if (error.code === 'ENOENT') message = '1Password CLI (op) was not found; install it or set OP_BIN.';
      else if (error.killed) message = '1Password CLI timed out.';
      else if (/multiple|more than one|ambiguous/i.test(stderr)) message = 'Multiple 1Password items match; choose an exact item ID.';
      else if (/not found|isn.t an item|is not an item|no item|does not exist/i.test(stderr)) message = '1Password item was not found in the agent vault.';
      reject(new LoginError(message));
    }));
  } catch (error) {
    if (error instanceof LoginError) throw error;
    throw new LoginError('Cannot run the 1Password CLI in this runtime.');
  }
}

const vaultArgs = () => ['--vault', runtimeEnv().OP_AGENT_VAULT || 'Agentes'];

function hostname(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.hostname.toLowerCase().replace(/\.$/, '') : '';
  } catch { return ''; }
}

let suffixRules;
async function registrableDomain(host) {
  if (isIP(host.replace(/^\[|\]$/g, '')) || !host.includes('.')) return host;
  // Pinned local PSL includes private suffixes: unrelated github.io tenants,
  // for example, must never be suggested as the same sign-in domain.
  suffixRules ??= readFile(new URL('./public_suffix_list.dat', import.meta.url), 'utf8').then(text => {
    const rules = { exact: new Set(), wildcard: new Set(), exception: new Set() };
    for (const line of text.split('\n')) {
      const rule = line.trim();
      if (!rule || rule.startsWith('//')) continue;
      const kind = rule.startsWith('!') ? 'exception' : rule.startsWith('*.') ? 'wildcard' : 'exact';
      rules[kind].add(domainToASCII(rule.replace(/^!|^\*\./, '')));
    }
    return rules;
  });
  const rules = await suffixRules;
  const labels = host.split('.');
  let suffixLength = 1;
  for (let i = 0; i < labels.length; i++) {
    const suffix = labels.slice(i).join('.');
    if (rules.exception.has(suffix)) { suffixLength = labels.length - i - 1; break; }
    if (rules.exact.has(suffix) || (i < labels.length - 1 && rules.wildcard.has(labels.slice(i + 1).join('.'))))
      suffixLength = Math.max(suffixLength, labels.length - i);
  }
  return labels.slice(-suffixLength - 1).join('.');
}

async function loginItems({ addresses = false } = {}) {
  const rows = JSON.parse(await runOp(['item', 'list', ...vaultArgs(), '--categories', 'Login', '--format', 'json']));
  if (!Array.isArray(rows)) throw new LoginError('1Password CLI returned an invalid item list.');
  return rows.filter(row => row.category === 'LOGIN').map(row => {
    if (typeof row.id !== 'string' || !/^[a-z\d][a-z\d_-]*$/i.test(row.id) || typeof row.title !== 'string')
      throw new LoginError('1Password CLI returned invalid login metadata.');
    const saved = (row.urls || []).filter(url => hostname(url.href));
    const item = { id: row.id, title: row.title, urls: [...new Set(saved.map(url => hostname(url.href)))] };
    // Only openLogin reads the saved address; it never crosses the public boundary.
    return addresses ? { ...item, address: (saved.find(url => url.primary) || saved[0])?.href } : item;
  });
}

async function selectedItem(item, options) {
  const key = typeof item === 'string' ? item : item?.id;
  if (typeof key !== 'string' || !key) throw new LoginError('Choose a 1Password login by exact title or item ID.');
  const matches = (await loginItems(options)).filter(row => row.id === key || (typeof item === 'string' && row.title === key));
  if (!matches.length) throw new LoginError('1Password item was not found in the agent vault.');
  if (matches.length !== 1) throw new LoginError('Multiple 1Password items match; choose an exact item ID.');
  return matches[0];
}

async function verifyDestination(locator, item) {
  let page;
  try {
    const url = await locator.evaluate(el => el.ownerDocument.location.href);
    if (typeof url !== 'string') throw new Error('Invalid document URL');
    page = new URL(url);
  } catch { throw new LoginError('Cannot verify the sign-in field document URL.'); }
  if (page.protocol !== 'https:') throw new LoginError('Sign-in fields must be on HTTPS pages.');
  const domain = await registrableDomain(hostname(page.href));
  for (const host of item.urls) {
    if (await registrableDomain(host) === domain) return;
  }
  throw new LoginError('Sign-in field domain does not match the saved 1Password login.');
}

export async function listLogins(options = {}) {
  return safe(async () => {
    const { url } = options;
    const host = url === undefined ? null : hostname(url);
    if (host === '') throw new LoginError('Provide an HTTP or HTTPS page URL.');
    const items = await loginItems();
    if (host === null) return items;
    const domain = await registrableDomain(host);
    const matches = [];
    for (const row of items) {
      for (const candidate of row.urls) {
        if (await registrableDomain(candidate) === domain) { matches.push(row); break; }
      }
    }
    return matches;
  }, 'listing logins');
}

export async function openLogin(tab, options = {}) {
  return safe(async () => {
    if (typeof tab?.goto !== 'function') throw new LoginError('Provide a tab with a goto method.');
    const item = await selectedItem(options.item, { addresses: true });
    let address = null;
    try { address = new URL(item.address); } catch { /* reported below */ }
    if (address?.protocol !== 'https:') throw new LoginError('The selected 1Password login has no HTTPS address to open.');
    address.username = address.password = '';
    await tab.goto(address.href);
    return { opened: true, host: address.hostname };
  }, 'opening the sign-in page');
}

export async function fillLogin(locators, options = {}) {
  return safe(async () => {
    const { username, password } = locators;
    if ((!username && !password) || (username && typeof username.fill !== 'function') || (password && typeof password.fill !== 'function'))
      throw new LoginError('Provide a username or password locator with a fill method.');
    const item = await selectedItem(options.item);
    // Verify every field's own frame before reading any credential values.
    for (const locator of [username, password].filter(Boolean)) await verifyDestination(locator, item);
    const login = JSON.parse(await runOp(['item', 'get', item.id, ...vaultArgs(), '--reveal', '--format', 'json']));
    if (login.category !== 'LOGIN' || !Array.isArray(login.fields)) throw new LoginError('1Password CLI returned an invalid login.');
    const usernameValue = login.fields.find(field => field.id === 'username')?.value;
    const passwordValue = login.fields.find(field => field.id === 'password')?.value;
    // Validate before filling so a missing field does not leave a partial form.
    if ((username && (typeof usernameValue !== 'string' || !usernameValue)) ||
        (password && (typeof passwordValue !== 'string' || !passwordValue)))
      throw new LoginError('The selected 1Password login is missing a requested field.');
    if (username) { await verifyDestination(username, item); await username.fill(usernameValue); }
    if (password) { await verifyDestination(password, item); await password.fill(passwordValue); }
    return { filledUsername: Boolean(username), filledPassword: Boolean(password) };
  }, 'filling login fields');
}

export async function fillOtp(locator, options = {}) {
  return safe(async () => {
    if (typeof locator?.fill !== 'function') throw new LoginError('Provide a one-time password locator with a fill method.');
    const item = await selectedItem(options.item);
    await verifyDestination(locator, item);
    const otp = (await runOp(['item', 'get', item.id, ...vaultArgs(), '--otp'])).trim();
    if (!otp) throw new LoginError('The selected 1Password login has no one-time password.');
    await verifyDestination(locator, item);
    await locator.fill(otp);
    return { filledOtp: true };
  }, 'filling a one-time password');
}
