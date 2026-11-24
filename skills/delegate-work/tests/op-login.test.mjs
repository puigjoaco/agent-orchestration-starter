import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { listLogins, fillLogin, fillOtp } from '../scripts/op-login.mjs';

// Synthetic credentials only. The real CLI, token and vault are never used.
const secrets = { token: 'synthetic-service-token', username: 'synthetic-user@example.invalid',
  password: 'synthetic-password-value', otp: '654321' };
const login = (id, title, urls) => ({ id, title, category: 'LOGIN', urls: urls.map(href => ({ href })) });

function field(fill = async () => {}, url = 'https://example.com/sign-in') {
  return { fill, evaluate: async fn => fn({ ownerDocument: {
    location: { href: typeof url === 'function' ? await url() : url },
  } }) };
}

function assertSafe(value) {
  const output = inspect(value, { depth: null, showHidden: true });
  for (const secret of Object.values(secrets)) assert.ok(!output.includes(secret), 'public output must omit synthetic secrets');
}

async function fixture(t) {
  const dir = await mkdtemp(new URL('./.op-login-test-', import.meta.url).pathname);
  const tokenFile = join(dir, 'token');
  const bin = join(dir, 'op');
  const dataFile = join(dir, 'data.json');
  const callsFile = join(dir, 'calls.jsonl');
  const env = { OP_AGENT_TOKEN_FILE: tokenFile, OP_AGENT_VAULT: 'TestVault', OP_BIN: bin, PATH: dir };
  const before = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  t.after(async () => {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  });
  Object.assign(process.env, env);
  let data = { ...secrets, items: [login('login-one', 'Example login', ['https://example.com/sign-in'])] };
  await writeFile(tokenFile, secrets.token, { mode: 0o600 });
  await writeFile(bin, `#!${process.execPath}
import { readFileSync, appendFileSync } from 'node:fs';
const data = JSON.parse(readFileSync(${JSON.stringify(dataFile)}, 'utf8'));
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify({ args,
  tokenMatches: process.env.OP_SERVICE_ACCOUNT_TOKEN === data.token }) + '\\n');
if (data.error || (args[1] === 'get' && data.getError)) {
  process.stdout.write(data.password);
  process.stderr.write((data.error || data.getError) + ' ' + Object.values(data).filter(v => typeof v === 'string').join(' ') + ' ' + process.env.OP_SERVICE_ACCOUNT_TOKEN);
  process.exit(1);
}
if (data.invalidJson) { process.stdout.write(data.password); process.exit(0); }
if (args[1] === 'list') process.stdout.write(JSON.stringify(data.items));
else if (args.includes('--otp')) {
  if (data.otp === null) { process.stderr.write('no one-time password ' + data.password); process.exit(1); }
  process.stdout.write(data.otp + '\\n');
} else process.stdout.write(JSON.stringify({ category: 'LOGIN', fields: [
  { id: 'username', value: data.username }, { id: 'password', value: data.password },
] }));
`, { mode: 0o700 });
  // .mjs ensures ESM regardless of the host's Node defaults.
  const esmBin = join(dir, 'fake-op.mjs');
  await writeFile(esmBin, await readFile(bin), { mode: 0o700 });
  // A shell-free executable named op is needed for PATH resolution checks.
  await rm(bin);
  const { symlink } = await import('node:fs/promises');
  await symlink(esmBin, bin);
  const configure = async patch => {
    data = { ...data, ...patch };
    await writeFile(dataFile, JSON.stringify(data));
  };
  await configure({});
  return { dir, bin, tokenFile, configure,
    calls: async () => (await readFile(callsFile, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) };
}

async function safeFailure(action, message) {
  await assert.rejects(action, error => {
    assert.ok(error instanceof Error);
    assertSafe(error);
    assert.match(error.message, message);
    assert.equal(error.cause, undefined, 'raw errors must not be retained as a cause');
    return true;
  });
}

test('lists only safe Login metadata; passes token via env and resolves op from PATH', async t => {
  const f = await fixture(t);
  delete process.env.OP_BIN;
  await f.configure({ items: [login('login-one', 'Example login', [
    'https://account:synthetic-password-value@accounts.example.com/login?q=secret#fragment',
    'https://accounts.example.com/another', 'not a URL',
  ]), { id: 'note', title: 'Note', category: 'SECURE_NOTE', fields: [{ value: secrets.password }] }] });
  const result = await listLogins();
  assert.deepEqual(result, [{ id: 'login-one', title: 'Example login', urls: ['accounts.example.com'] }]);
  assertSafe(result);
  const calls = await f.calls();
  assert.ok(calls.every(call => call.tokenMatches));
  assert.deepEqual(calls[0].args, ['item', 'list', '--vault', 'TestVault', '--categories', 'Login', '--format', 'json']);
  assertSafe(calls);
});

test('fills both fields and OTP without returning their values', async t => {
  const f = await fixture(t);
  const filled = [];
  const result = await fillLogin({ username: field(async value => filled.push(value)),
    password: field(async value => filled.push(value)) }, { item: 'Example login' });
  assert.deepEqual(filled, [secrets.username, secrets.password]);
  assert.deepEqual(result, { filledUsername: true, filledPassword: true });
  assertSafe(result);
  const otpResult = await fillOtp(field(async value => filled.push(value)), { item: { id: 'login-one' } });
  assert.equal(filled.at(-1), secrets.otp);
  assert.deepEqual(otpResult, { filledOtp: true });
  assertSafe(otpResult);
  const calls = await f.calls();
  assert.ok(calls.every(call => call.tokenMatches));
  assert.ok(calls.some(call => call.args.includes('--reveal')));
  assert.ok(calls.some(call => call.args.includes('--otp')));
  assertSafe(calls);
});

test('supports a two-step page with only the requested field', async t => {
  const f = await fixture(t);
  const filled = [];
  await f.configure({ password: null });
  const first = await fillLogin({ username: field(async value => filled.push(value)) }, { item: 'login-one' });
  assert.deepEqual(first, { filledUsername: true, filledPassword: false });
  await f.configure({ username: null, password: secrets.password });
  const second = await fillLogin({ password: field(async value => filled.push(value)) }, { item: 'login-one' });
  assert.deepEqual(second, { filledUsername: false, filledPassword: true });
  assert.deepEqual(filled, [secrets.username, secrets.password]);
  assertSafe([first, second]);
});

test('matches registrable domains, including multi-label, wildcard and private suffixes', async t => {
  const f = await fixture(t);
  await f.configure({ items: [
    login('base', 'Base', ['https://example.com']), login('sibling', 'Sibling', ['https://login.example.com']),
    login('attacker', 'Unrelated', ['https://example.com.attacker.com']),
    login('uk', 'UK', ['https://login.example.co.uk']), login('other-uk', 'Other UK', ['https://other.co.uk']),
    login('private', 'Private', ['https://a.github.io']), login('other-private', 'Other private', ['https://b.github.io']),
    login('wild', 'Wildcard', ['https://a.b.ck']), login('other-wild', 'Other wildcard', ['https://c.ck']),
    login('exception', 'Exception', ['https://www.ck']),
    login('idn', 'IDN', ['https://bücher.de']),
    login('ip', 'IP', ['https://127.0.0.1:4000']), login('other-ip', 'Other IP', ['https://127.0.0.2']),
    login('ipv6', 'IPv6', ['https://[::1]']),
  ] });
  const ids = async url => (await listLogins({ url })).map(row => row.id);
  assert.deepEqual(await ids('https://accounts.EXAMPLE.com.:443/sign-in'), ['base', 'sibling']);
  assert.deepEqual(await ids('https://example.co.uk'), ['uk']);
  assert.deepEqual(await ids('https://login.a.github.io'), ['private']);
  assert.deepEqual(await ids('https://login.a.b.ck'), ['wild']);
  assert.deepEqual(await ids('https://b.ck'), [], 'a public suffix is not a registrable domain');
  assert.deepEqual(await ids('https://c.b.ck'), [], 'wildcard suffix tenants remain separate');
  assert.deepEqual(await ids('https://login.www.ck'), ['exception']);
  assert.deepEqual(await ids('https://shop.xn--bcher-kva.de'), ['idn']);
  assert.deepEqual(await ids('http://127.0.0.1'), ['ip']);
  assert.deepEqual(await ids('http://[::1]:8080'), ['ipv6']);
  assert.deepEqual(await ids('https://unmatched.invalid'), []);
  await safeFailure(() => listLogins({ url: 'not a URL' }), /HTTP or HTTPS/);
});

test('refuses token modes other than 0600 before starting op', async t => {
  const f = await fixture(t);
  for (const mode of [0o644, 0o640, 0o604, 0o660, 0o400]) {
    await chmod(f.tokenFile, mode);
    await safeFailure(() => listLogins(), /mode 0600/);
  }
  await assert.rejects(readFile(join(f.dir, 'calls.jsonl')), { code: 'ENOENT' });
});

test('reports a missing token, empty token and non-file token path safely', async t => {
  const f = await fixture(t);
  await rm(f.tokenFile);
  await safeFailure(() => listLogins(), /missing or unreadable/);
  await writeFile(f.tokenFile, '', { mode: 0o600 });
  await safeFailure(() => listLogins(), /empty/);
  process.env.OP_AGENT_TOKEN_FILE = f.dir;
  await safeFailure(() => listLogins(), /regular file/);
});

test('reports a missing op without leaking the token', async t => {
  const f = await fixture(t);
  process.env.OP_BIN = join(f.dir, 'missing-op');
  await safeFailure(() => listLogins(), /CLI \(op\) was not found/);
});

test('rereads the token file on the next call', async t => {
  const f = await fixture(t);
  await listLogins();
  const rotated = 'synthetic-rotated-token';
  await writeFile(f.tokenFile, rotated);
  await f.configure({ token: rotated });
  await listLogins();
  assert.ok((await f.calls()).every(call => call.tokenMatches));
});

test('rejects missing and ambiguous logins before fetching values', async t => {
  const f = await fixture(t);
  const locator = field(() => assert.fail('must not fill'));
  await safeFailure(() => fillLogin({ password: locator }, { item: 'missing' }), /not found/);
  await f.configure({ items: [login('one', 'Duplicate', ['https://example.com']), login('two', 'Duplicate', ['https://example.com'])] });
  await safeFailure(() => fillLogin({ password: locator }, { item: 'Duplicate' }), /Multiple/);
  assert.ok((await f.calls()).every(call => call.args[1] === 'list'));
  // Selecting the ID disambiguates duplicate titles.
  assertSafe(await fillLogin({ password: field() }, { item: { id: 'two' } }));
});

test('discards stdout/stderr and raw child errors for common CLI failures', async t => {
  const f = await fixture(t);
  for (const [error, message] of [['item not found', /not found/], ['more than one item', /Multiple/],
    ['authorization refused', /CLI failed/]]) {
    await f.configure({ error });
    await safeFailure(() => listLogins(), message);
  }
  await f.configure({ error: null, invalidJson: true });
  await safeFailure(() => listLogins(), /sign-in failed/);
  await f.configure({ invalidJson: false, getError: 'item not found' });
  await safeFailure(() => fillLogin({ password: field() }, { item: 'login-one' }), /not found/);
});

test('scrubs locator errors, even if the locator includes filled values', async t => {
  await fixture(t);
  const fail = field(async value => { throw new Error(`${value} ${secrets.token}`); });
  await safeFailure(() => fillLogin({ username: fail }, { item: 'login-one' }), /sign-in failed/);
  await safeFailure(() => fillLogin({ password: fail }, { item: 'login-one' }), /sign-in failed/);
  await safeFailure(() => fillOtp(fail, { item: 'login-one' }), /sign-in failed/);
});

test('missing fields, missing OTP and invalid locators return safe errors', async t => {
  const f = await fixture(t);
  const locator = field(() => assert.fail('must not fill incomplete credentials'));
  await f.configure({ password: null });
  await safeFailure(() => fillLogin({ username: locator, password: locator }, { item: 'login-one' }), /missing a requested field/);
  await f.configure({ otp: null });
  await safeFailure(() => fillOtp(locator, { item: 'login-one' }), /CLI failed/);
  await f.configure({ otp: '' });
  await safeFailure(() => fillOtp(locator, { item: 'login-one' }), /no one-time password/);
  await safeFailure(() => fillLogin({}, { item: 'login-one' }), /locator/);
  await safeFailure(() => fillOtp({}, { item: 'login-one' }), /locator/);
  await safeFailure(() => fillLogin({ password: field() }), /exact title or item ID/);
});

test('refuses look-alike domains and insecure pages before fetching any values', async t => {
  const f = await fixture(t);
  const filled = [];
  for (const url of ['https://example.com.attacker.com/sign-in', 'http://example.com/sign-in']) {
    const locator = field(async value => filled.push(value), url);
    for (const name of ['username', 'password'])
      await safeFailure(() => fillLogin({ [name]: locator }, { item: 'login-one' }), /domain does not match|HTTPS/);
    await safeFailure(() => fillOtp(locator, { item: 'login-one' }), /domain does not match|HTTPS/);
  }
  assert.deepEqual(filled, []);
  assert.ok((await f.calls()).every(call => call.args[1] === 'list'), 'no credential or OTP fetch on a wrong page');
});

test('checks the password iframe before reading values or filling the username', async t => {
  const f = await fixture(t);
  const filled = [];
  await safeFailure(() => fillLogin({
    username: field(async value => filled.push(value)),
    password: field(async value => filled.push(value), 'https://unrelated.invalid/iframe'),
  }, { item: 'login-one' }), /domain does not match/);
  assert.deepEqual(filled, []);
  assert.ok((await f.calls()).every(call => call.args[1] === 'list'));
});

test('allows matching HTTPS subdomains for credentials and OTP', async t => {
  const f = await fixture(t);
  await f.configure({ items: [login('login-one', 'Example login', ['https://login.example.co.uk'])] });
  const filled = [];
  const locator = field(async value => filled.push(value), 'https://accounts.example.co.uk/sign-in');
  assertSafe(await fillLogin({ username: locator, password: locator }, { item: 'login-one' }));
  assertSafe(await fillOtp(locator, { item: 'login-one' }));
  assert.deepEqual(filled, [secrets.username, secrets.password, secrets.otp]);
});

test('rechecks the document URL immediately before each fill', async t => {
  await fixture(t);
  const filled = [];
  for (const name of ['username', 'password', 'otp']) {
    let checks = 0;
    const locator = field(async value => filled.push(value),
      () => ++checks === 1 ? 'https://example.com/sign-in' : 'https://unrelated.invalid/sign-in');
    await safeFailure(() => name === 'otp' ? fillOtp(locator, { item: 'login-one' })
      : fillLogin({ [name]: locator }, { item: 'login-one' }), /domain does not match/);
    assert.equal(checks, 2);
  }
  assert.deepEqual(filled, []);
});

test('refuses unresolved field URLs and strips locator evaluation errors', async t => {
  const f = await fixture(t);
  for (const evaluate of [undefined, async () => 'not a URL', async () => null,
    async () => { throw new Error(Object.values(secrets).join(' ')); }]) {
    const locator = { fill: () => assert.fail('must not fill'), evaluate };
    await safeFailure(() => fillLogin({ password: locator }, { item: 'login-one' }), /Cannot verify/);
    await safeFailure(() => fillOtp(locator, { item: 'login-one' }), /Cannot verify/);
  }
  assert.ok((await f.calls()).every(call => call.args[1] === 'list'));
});
