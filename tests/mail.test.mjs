import test from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { createServer } from 'node:net';
import { createStore } from '../lib/store.mjs';
import { createMail, validateMail } from '../lib/mail.mjs';
import { startServer } from '../server.mjs';

const SETTINGS = { host: 'smtp.example.com', port: 587, security: 'starttls', user: 'sender@example.com', password: 'private-smtp-secret', from: 'sender@example.com', fromName: '栖忆测试' };
const MESSAGE = { to: 'reader@example.com', cc: 'copy@example.com', bcc: 'blind@example.com', subject: '一封测试邮件', text: '你好，\n这是正文。' };
function fixture(t, extra = {}) {
  const store = createStore(), sent = [], configs = [];
  t.after(() => store.close());
  const model = { complete: async () => ({ subject: 'AI 主题', text: 'AI 正文' }) };
  const mail = createMail(store, model, { smtpPassword: '', mailTransportFactory: config => {
    configs.push(config);
    return { verify: async () => true, close() {}, sendMail: async message => { sent.push(message); return { accepted: [...message.to, ...message.cc, ...message.bcc], rejected: [] }; } };
  }, ...extra });
  return { store, mail, sent, configs };
}
const configured = (t, extra) => { const result = fixture(t, extra); result.mail.update(SETTINGS); return result; };
const confirm = preview => ({ token: preview.id, confirmed: true });

test('mail is offline by default; setup and bootstrap never create a transport or persist secrets', t => {
  const { store, mail, configs } = fixture(t);
  assert.equal(mail.settings().host, ''); assert.equal(mail.settings().hasPassword, false);
  assert.throws(() => mail.prepare(MESSAGE), /先保存/);
  mail.update(SETTINGS);
  assert.equal(mail.settings().hasPassword, true);
  assert.ok(!JSON.stringify(mail.bootstrap()).includes(SETTINGS.password));
  assert.ok(!store.get('SELECT value FROM mail_settings').value.includes(SETTINGS.password));
  assert.equal(configs.length, 0);
});

test('settings validate atomically, preserve blank passwords, and clear credentials on account/host changes', t => {
  const { mail } = configured(t);
  for (const bad of [{ host: 'smtp://bad/secret' }, { port: 0 }, { port: '465' }, { security: 'none' }, { from: 'a@example.com\r\nBcc:x@example.com' }, { fromName: 'a\nb' }, { password: 'secret\0' }]) assert.throws(() => mail.update(bad));
  assert.equal(mail.settings().host, SETTINGS.host);
  mail.update({ password: '' }); assert.equal(mail.settings().hasPassword, true);
  mail.update({ host: 'new.example.com' }); assert.equal(mail.settings().hasPassword, false);
  mail.update({ password: 'new' }); assert.equal(mail.settings().hasPassword, true);
  mail.update({ user: 'new@example.com' }); assert.equal(mail.settings().hasPassword, false);
  mail.update({ password: 'new', clearPassword: true }); assert.equal(mail.settings().hasPassword, false);
});

test('validation blocks header injection, structured content, malformed addresses and excess recipients', () => {
  for (const bad of [{ to: 'x@example.com\nBcc: hidden@example.com' }, { to: 'Display <x@example.com>' }, { to: 'x..y@example.com' }, { to: 'a@bad..com' }, { cc: 'bad' }, { bcc: 'x@example.com\r\n' }, { subject: 'hello\r\nX-Header: yes' }, { text: { path: 'secrets.env' } }, { text: 'hello\0' }, { subject: '' }, { text: 'a'.repeat(50001) }, { to: Array.from({ length: 21 }, (_, i) => `a${i}@example.com`).join(',') }]) assert.throws(() => validateMail({ ...MESSAGE, ...bad }));
  const m = validateMail({ ...MESSAGE, to: 'a@例子.中国；A@xn--fsqu00a.xn--fiqs8s', cc: 'a@例子.中国', bcc: '' });
  assert.deepEqual(m.to, ['a@xn--fsqu00a.xn--fiqs8s']); assert.deepEqual(m.cc, []);
});

test('preview is immutable, sends only after explicit confirmation, and idempotently returns previous outcome', async t => {
  const { mail, sent, store, configs } = configured(t);
  const { preview } = mail.prepare(MESSAGE);
  assert.equal(sent.length, 0); assert.equal(mail.list().length, 0); assert.equal(preview.message.from, SETTINGS.from);
  assert.equal(preview.revision, undefined);
  await assert.rejects(mail.send({ token: preview.id }), /明确确认/);
  const { mail: result } = await mail.send({ ...confirm(preview), to: 'evil@example.com', text: 'tampered' });
  assert.equal(result.status, 'sent'); assert.deepEqual(sent[0].to, ['reader@example.com']); assert.equal(sent[0].text, MESSAGE.text);
  assert.equal(sent[0].disableFileAccess, true); assert.equal(sent[0].disableUrlAccess, true);
  assert.equal(configs[0].secure, false); assert.equal(configs[0].requireTLS, true); assert.equal(configs[0].tls.rejectUnauthorized, true);
  assert.equal(configs[0].auth.pass, SETTINGS.password); assert.equal(configs[0].debug, false);
  const repeat = await mail.send(confirm(preview)); assert.equal(repeat.mail.status, 'sent'); assert.equal(sent.length, 1);
  assert.equal(mail.list().length, 1); assert.ok(!store.get('SELECT value FROM mail_outbox').value.includes(SETTINGS.password));
});

test('two simultaneous confirms claim one transaction; deleting in-flight mail is rejected', async t => {
  let finish, calls = 0;
  const { mail } = configured(t, { mailTransportFactory: () => ({ close() {}, sendMail: () => { calls++; return new Promise(resolve => { finish = resolve; }); } }) });
  const { preview } = mail.prepare(MESSAGE);
  const pending = mail.send(confirm(preview));
  assert.equal((await mail.send(confirm(preview))).mail.status, 'sending');
  assert.throws(() => mail.remove(preview.id), /正在发送/);
  finish({ accepted: [...preview.message.to, ...preview.message.cc, ...preview.message.bcc], rejected: [] });
  assert.equal((await pending).mail.status, 'sent'); assert.equal(calls, 1);
});

test('expiry, settings changes and restart invalidate pending previews', async t => {
  let clock = Date.now();
  const { mail, store } = configured(t, { mailClock: () => clock });
  const first = mail.prepare(MESSAGE).preview;
  clock += 10 * 60_000;
  await assert.rejects(mail.send(confirm(first)), error => error.status === 410);
  const second = mail.prepare(MESSAGE).preview;
  mail.update({ fromName: '修改署名' });
  await assert.rejects(mail.send(confirm(second)), error => error.status === 409);
  const third = mail.prepare(MESSAGE).preview;
  const restarted = createMail(store, null, { smtpPassword: SETTINGS.password });
  await assert.rejects(restarted.send(confirm(third)), error => error.status === 409);
});

test('SMTP verify checks connection only and masks transport errors', async t => {
  const { mail, sent, configs } = configured(t);
  assert.equal((await mail.verify()).ok, true); assert.equal(sent.length, 0); assert.equal(configs.length, 1);
  const errorStore = createStore(); t.after(() => errorStore.close());
  const broken = createMail(errorStore, null, { smtpPassword: '', mailTransportFactory: () => ({ verify: async () => { throw new Error(SETTINGS.password); }, close() {} }) });
  broken.update(SETTINGS);
  await assert.rejects(broken.verify(), error => !error.message.includes(SETTINGS.password) && error.status === 502);
});

for (const [name, info, expected] of [
  ['partial recipients', { accepted: ['reader@example.com'], rejected: ['copy@example.com', 'blind@example.com'] }, 'partial'],
  ['all rejected', { accepted: [], rejected: ['reader@example.com', 'copy@example.com', 'blind@example.com'] }, 'failed'],
  ['incomplete result', { accepted: ['reader@example.com'], rejected: [] }, 'unknown'],
]) test(`SMTP ${name} is recorded without blind retries`, async t => {
  let calls = 0;
  const { mail } = configured(t, { mailTransportFactory: () => ({ close() {}, sendMail: async () => { calls++; return info; } }) });
  const { preview } = mail.prepare(MESSAGE); const result = (await mail.send(confirm(preview))).mail;
  assert.equal(result.status, expected); await mail.send(confirm(preview)); assert.equal(calls, 1);
});

for (const [code, command, responseCode, expected] of [
  ['EAUTH', 'AUTH PLAIN', 535, 'failed'], ['ETIMEDOUT', 'DATA', undefined, 'unknown'], ['ESOCKET', undefined, undefined, 'unknown'], ['EMESSAGE', 'DATA', 550, 'failed'],
]) test(`SMTP ${code}/${command} retains an accurate, sanitized failure state`, async t => {
  const { mail } = configured(t, { mailTransportFactory: () => ({ close() {}, sendMail: async () => { throw Object.assign(new Error(SETTINGS.password), { code, command, responseCode }); } }) });
  const { preview } = mail.prepare(MESSAGE); const result = (await mail.send(confirm(preview))).mail;
  assert.equal(result.status, expected); assert.ok(!JSON.stringify(result).includes(SETTINGS.password));
});

test('restart recovers interrupted sends as unknown, never retries, and allows local history deletion', async t => {
  const { mail, store } = configured(t); const { preview } = mail.prepare(MESSAGE);
  store.run("UPDATE mail_outbox SET status='sending' WHERE id=?", preview.id);
  let calls = 0;
  const restarted = createMail(store, null, { smtpPassword: '', mailTransportFactory: () => { calls++; } });
  assert.equal(restarted.list()[0].status, 'unknown');
  assert.equal((await restarted.send(confirm(preview))).mail.status, 'unknown'); assert.equal(calls, 0);
  restarted.remove(preview.id); assert.equal(restarted.list().length, 0);
});

test('AI draft uses only the explicit instruction and never sees SMTP credentials/recipients', async t => {
  const { mail } = configured(t);
  let messages;
  const draftStore = createStore(); t.after(() => draftStore.close());
  const drafting = createMail(draftStore, { complete: async input => { messages = input; return { subject: '邀请', text: '你好，时间【待补充】。' }; } }, { smtpPassword: SETTINGS.password });
  drafting.update({ host: SETTINGS.host, from: SETTINGS.from });
  const result = await drafting.draft({ instruction: '写邀请', to: 'private@example.com' });
  assert.equal(result.draft.subject, '邀请'); assert.equal(messages.length, 2);
  assert.ok(!JSON.stringify(messages).includes(SETTINGS.password)); assert.ok(!JSON.stringify(messages).includes('private@example.com'));
  assert.equal(mail.list().length, 0);
});

test('real Nodemailer SMTP on loopback generates plain text, includes envelope Bcc and strips Bcc headers', async t => {
  let raw = ''; const recipients = [], sockets = new Set();
  const server = createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.setEncoding('utf8');
    socket.write('220 local.test ESMTP\r\n'); let buffer = '', data = false;
    socket.on('data', chunk => {
      buffer += chunk;
      while (buffer.includes('\r\n')) {
        const at = buffer.indexOf('\r\n'), line = buffer.slice(0, at); buffer = buffer.slice(at + 2);
        if (data) { if (line === '.') { data = false; socket.write('250 queued\r\n'); } else raw += line + '\r\n'; }
        else if (line.startsWith('EHLO')) socket.write('250-local.test\r\n250 SIZE 200000\r\n');
        else if (line.startsWith('RCPT TO:')) { recipients.push(line); socket.write('250 OK\r\n'); }
        else if (line === 'DATA') { data = true; socket.write('354 End with dot\r\n'); }
        else if (line === 'QUIT') socket.end('221 Bye\r\n');
        else socket.write('250 OK\r\n');
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  // Only the local test adapter disables TLS. Production transport always requires it.
  const { mail } = configured(t, { mailTransportFactory: config => nodemailer.createTransport({ ...config, host: '127.0.0.1', port: server.address().port, secure: false, requireTLS: false, ignoreTLS: true, auth: undefined }) });
  assert.equal((await mail.send(confirm(mail.prepare(MESSAGE).preview))).mail.status, 'sent');
  assert.match(raw, /Content-Type: text\/plain/); assert.doesNotMatch(raw, /^Bcc:/im); assert.doesNotMatch(raw, /text\/html/);
  assert.match(raw, /To: reader@example.com/); assert.match(raw, /Cc: copy@example.com/);
  assert.ok(recipients.some(line => line.includes('blind@example.com')));
});

test('mail HTTP endpoints enforce prepare-confirm flow and expose safe settings/history', async t => {
  let sends = 0;
  const app = await startServer({ port: 0, dbPath: ':memory:', scheduler: false, modelOptions: { smtpPassword: '', mailTransportFactory: () => ({ close() {}, verify: async () => true, sendMail: async m => { sends++; return { accepted: [...m.to, ...m.cc, ...m.bcc], rejected: [] }; } }) } });
  t.after(() => app.close());
  const req = (path, method = 'GET', body) => fetch(app.url + '/api/mail' + path, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  assert.equal((await req('/prepare', 'POST', MESSAGE)).status, 503);
  const update = await (await req('/settings', 'PUT', SETTINGS)).json(); assert.equal(update.settings.hasPassword, true); assert.ok(!JSON.stringify(update).includes(SETTINGS.password));
  assert.equal((await req('/verify', 'POST', {})).status, 200); assert.equal(sends, 0);
  const { preview } = await (await req('/prepare', 'POST', MESSAGE)).json(); assert.equal(sends, 0);
  assert.equal((await req('/send', 'POST', { token: preview.id })).status, 400);
  const result = await (await req('/send', 'POST', confirm(preview))).json(); assert.equal(result.mail.status, 'sent');
  await req('/send', 'POST', confirm(preview)); assert.equal(sends, 1);
  assert.equal((await (await req('/history')).json()).history.length, 1);
  assert.equal((await req(`/history/${preview.id}`, 'DELETE', {})).status, 200);
  assert.equal((await (await req('/history')).json()).history.length, 0);
});
