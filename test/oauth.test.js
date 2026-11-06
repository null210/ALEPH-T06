// GitHub · Google 로그인. 실제 제공자 대신 가짜 응답(fakeFetch)으로 흐름을 확인한다.  npm test
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';

let db; let server; let base;
// 가짜 제공자가 돌려줄 사람과, 서버가 보낸 토큰 요청을 기록한다
let ghUser; let ghEmails; let googleUser; let tokenRequests;
async function fakeFetch(url, opts = {}) {
  const json = (o) => ({ json: async () => o });
  if (url.includes('github.com/login/oauth/access_token') || url.includes('oauth2.googleapis.com/token')) {
    tokenRequests.push({ url, body: Object.fromEntries(new URLSearchParams(String(opts.body))) });
    return json({ access_token: 'fake-access-token' });
  }
  if (url === 'https://api.github.com/user') return json(ghUser);
  if (url === 'https://api.github.com/user/emails') return json(ghEmails);
  if (url.includes('openidconnect.googleapis.com')) return json(googleUser);
  throw new Error(`예상 못 한 주소 ${url}`);
}

const ENV = { GITHUB_CLIENT_ID: 'gh-id', GITHUB_CLIENT_SECRET: 'gh-secret-for-test', GOOGLE_CLIENT_ID: 'gg-id', GOOGLE_CLIENT_SECRET: 'gg-secret-for-test' };
before(async () => {
  Object.assign(process.env, ENV);
  db = await openDb({ dataDir: 'memory://' });
  server = createApp(db, { oauthFetch: fakeFetch }).listen(0);
  base = `http://localhost:${server.address().port}`;
});
after(async () => { server.close(); await db.close(); for (const k of Object.keys(ENV)) delete process.env[k]; });
beforeEach(() => {
  tokenRequests = [];
  ghUser = { id: 1001, login: 'octo' };
  ghEmails = [{ email: 'Octo@Example.com', primary: true, verified: true }];
  googleUser = { sub: 'g-2002', email: 'gina@example.com', email_verified: true };
});

const get = (p, cookie) => fetch(`${base}${p}`, { redirect: 'manual', headers: cookie ? { Cookie: cookie } : {} });
const cookieOf = (res, name) => (res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`)) ?? '').split(';')[0];

// 버튼 → 제공자 → 돌아오기 를 한 번에
async function oauthLogin(provider, { tamperState = false } = {}) {
  const start = await get(`/api/auth/oauth/${provider}/start`);
  assert.equal(start.status, 302);
  const loc = new URL(start.headers.get('location'));
  const stateCookie = cookieOf(start, 'pds_oauth');
  const state = tamperState ? 'someone-elses-state' : loc.searchParams.get('state');
  const cb = await get(`/api/auth/oauth/${provider}/callback?code=fake-code&state=${state}`, stateCookie);
  return { start, loc, stateCookie, cb, session: cookieOf(cb, 'pds_sid') };
}
const me = async (session) => (await (await get('/api/auth/me', session)).json()).user;

test('켜진 제공자 목록과, 환경 변수가 없으면 꺼짐', async () => {
  const r = await (await get('/api/auth/providers')).json();
  assert.deepEqual(r.providers.map((p) => p.id), ['github', 'google']);
  const saved = process.env.GITHUB_CLIENT_SECRET; delete process.env.GITHUB_CLIENT_SECRET;
  try {
    assert.equal((await get('/api/auth/oauth/github/start')).status, 404);
    assert.deepEqual((await (await get('/api/auth/providers')).json()).providers.map((p) => p.id), ['google']);
  } finally { process.env.GITHUB_CLIENT_SECRET = saved; }
});

test('GitHub: 시작하면 state 를 HttpOnly 쿠키에 두고 GitHub 로 보낸다 (secret 은 주소에 없음)', async () => {
  const { start, loc } = await oauthLogin('github');
  assert.equal(loc.origin + loc.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(loc.searchParams.get('client_id'), 'gh-id');
  assert.match(loc.searchParams.get('redirect_uri'), /\/api\/auth\/oauth\/github\/callback$/);
  assert.match(loc.searchParams.get('state'), /^[A-Za-z0-9_-]{43}$/);
  assert.ok(!start.headers.get('location').includes('gh-secret'));
  assert.match(start.headers.get('set-cookie'), /pds_oauth=.*HttpOnly; SameSite=Lax; Max-Age=600/);
});

test('GitHub: 돌아오면 새 계정이 생기고 기존과 같은 세션 쿠키로 로그인된다', async () => {
  const { cb, session } = await oauthLogin('github');
  assert.equal(cb.status, 302);
  assert.equal(cb.headers.get('location'), '/#/');
  assert.match(session, /^pds_sid=[A-Za-z0-9_-]{43}$/);
  const u = await me(session);
  assert.equal(u.email, 'octo@example.com');
  assert.equal(u.has_password, false);
  assert.deepEqual(u.providers, ['github']);
  assert.equal(tokenRequests[0].body.client_secret, 'gh-secret-for-test', 'secret 은 서버끼리 요청에만');
  // 같은 GitHub 계정으로 다시 들어오면 같은 사람
  const again = await oauthLogin('github');
  assert.equal((await me(again.session)).id, u.id);
  // 로그아웃하면 그 세션도 끊긴다
  await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { Cookie: session } });
  assert.equal((await get('/api/plans', session)).status, 401);
});

test('state 가 쿠키와 다르면 거절하고 로그인시키지 않는다', async () => {
  const { cb, session } = await oauthLogin('github', { tamperState: true });
  assert.equal(cb.status, 302);
  assert.equal(cb.headers.get('location'), '/#/login?error=state');
  assert.equal(session, '');
  // 쿠키 없이 돌아와도 거절
  const r = await get('/api/auth/oauth/github/callback?code=x&state=y');
  assert.equal(r.headers.get('location'), '/#/login?error=state');
});

test('제공자가 인증하지 않은 이메일이면 거절한다', async () => {
  ghUser = { id: 3003 };
  ghEmails = [{ email: 'unverified@example.com', primary: true, verified: false }];
  const { cb, session } = await oauthLogin('github');
  assert.equal(cb.headers.get('location'), '/#/login?error=email');
  assert.equal(session, '');
});

test('Google: PKCE 로 시작하고, 같은 이메일로 비밀번호 가입한 계정이 있으면 그 계정에 연결된다', async () => {
  const su = await fetch(`${base}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'gina@example.com', password: 'gina-pass-123' }) });
  const pwSession = su.headers.get('set-cookie').split(';')[0];
  await fetch(`${base}/api/plans`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: pwSession }, body: JSON.stringify({ title: '지나의 계획', start_date: '2026-11-06', end_date: '2026-11-07', priority: 1, success_criteria: 'x', estimate_minutes: 1 }) });

  const { loc, session } = await oauthLogin('google');
  assert.equal(loc.searchParams.get('code_challenge_method'), 'S256');
  const verifier = tokenRequests[0].body.code_verifier;
  assert.equal(createHash('sha256').update(verifier).digest('base64url'), loc.searchParams.get('code_challenge'), 'PKCE 짝이 맞음');
  const u = await me(session);
  assert.equal(u.email, 'gina@example.com');
  assert.equal(u.has_password, true);
  assert.deepEqual(u.providers, ['google']);
  const plans = await (await get('/api/plans', session)).json();
  assert.deepEqual(plans.map((p) => p.title), ['지나의 계획'], 'Google 로 들어와도 같은 계정의 자료');
});

test('GitHub·Google 전용 계정: 비밀번호 로그인은 같은 문장으로 거절, 비밀번호를 처음 정할 수 있고, 이메일 확인으로 계정 삭제', async () => {
  ghUser = { id: 4004 };
  ghEmails = [{ email: 'social@example.com', primary: true, verified: true }];
  const { session } = await oauthLogin('github');
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'social@example.com', password: 'anything-123' }) });
  assert.equal(login.status, 401);
  assert.equal((await login.json()).error, '이메일 또는 비밀번호가 맞지 않습니다.');

  const del = (body, c) => fetch(`${base}/api/auth/account`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', Cookie: c }, body: JSON.stringify(body) });
  assert.equal((await del({ confirm_email: 'wrong@example.com' }, session)).status, 400);

  const setPw = await fetch(`${base}/api/auth/password`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: session }, body: JSON.stringify({ new_password: 'first-pass-123' }) });
  assert.equal(setPw.status, 200, '지금 비밀번호 없이 처음 정함');
  const fresh = setPw.headers.get('set-cookie').split(';')[0];
  assert.equal((await get('/api/plans', session)).status, 401, '정하면 예전 세션은 끊김');
  assert.equal((await me(fresh)).has_password, true);
  assert.equal((await del({ password: 'first-pass-123' }, fresh)).status, 204);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM oauth_accounts WHERE email = 'social@example.com'"))[0].n, 0, '연결 기록도 함께 지워짐');
});

test('사용자가 제공자 화면에서 취소하면 로그인 화면으로 돌아간다', async () => {
  const r = await get('/api/auth/oauth/google/callback?error=access_denied');
  assert.equal(r.headers.get('location'), '/#/login?error=denied');
});
