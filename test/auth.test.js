// 7번 과제: 가입·로그인을 붙여 "내 자료는 나만" 보이게 했는지 확인한다.  npm test
// 테스트 이름은 완주 체크리스트 문장을 그대로 따른다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { MAX_FAILS } from '../server/auth.js';

let db; let server; let base;

async function req(method, p, { body, cookie, headers = {} } = {}) {
  const res = await fetch(`${base}/api${p}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null, setCookie: res.headers.get('set-cookie') };
}
async function signup(email, password) {
  const r = await req('POST', '/auth/signup', { body: { email, password } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return { cookie: r.setCookie.split(';')[0], user: r.data.user, setCookie: r.setCookie };
}
const PLAN = { title: '내 계획', start_date: '2026-11-06', end_date: '2026-11-10', priority: 1, success_criteria: '5일 기록', estimate_minutes: 300 };

let A; let B; // 두 사람
let aPlan; let aTask; let aReview; let bPlan; let bTask; let bReview;

before(async () => {
  db = await openDb({ dataDir: 'memory://' });
  server = createApp(db).listen(0);
  base = `http://localhost:${server.address().port}`;
  A = await signup('alice@example.com', 'alice-pass-123');
  B = await signup('bob@example.com', 'bob-pass-456');
  const mk = async (who, title) => {
    const plan = (await req('POST', '/plans', { cookie: who.cookie, body: { ...PLAN, title } })).data;
    const task = (await req('POST', `/plans/${plan.id}/tasks`, { cookie: who.cookie, body: { title: `${title}의 할 일`, due_date: '2026-11-07', priority: 2, estimate_minutes: 30 } })).data;
    await req('POST', `/tasks/${task.id}/logs`, { cookie: who.cookie, body: { started_at: '2026-11-06T09:00:00+09:00', ended_at: '2026-11-06T09:30:00+09:00', note: `${title} 메모` } });
    const review = (await req('POST', `/plans/${plan.id}/reviews`, { cookie: who.cookie, body: { improvement: `${title}의 고칠 점` } })).data;
    return [plan, task, review];
  };
  [aPlan, aTask, aReview] = await mk(A, 'A의 비밀 계획');
  [bPlan, bTask, bReview] = await mk(B, 'B의 비밀 계획');
});
after(async () => { server.close(); await db.close(); });

test('가입·로그인·로그아웃이 된다', async () => {
  const s = await signup('carol@example.com', 'carol-pass-789');
  assert.match(s.setCookie, /^pds_sid=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=604800/);
  assert.equal((await req('GET', '/auth/me', { cookie: s.cookie })).data.user.email, 'carol@example.com');

  const login = await req('POST', '/auth/login', { body: { email: 'CAROL@example.com ', password: 'carol-pass-789' } });
  assert.equal(login.status, 200, '이메일은 대소문자·앞뒤 공백 무시');
  assert.notEqual(login.setCookie.split(';')[0], s.cookie, '로그인할 때마다 새 토큰');

  const out = await req('POST', '/auth/logout', { cookie: s.cookie });
  assert.equal(out.status, 204);
  assert.match(out.setCookie, /pds_sid=; .*Max-Age=0/);
});

test('틀린 비밀번호·없는 이메일은 같은 말로 거절, 중복 가입·짧은 비밀번호도 거절', async () => {
  const wrong = await req('POST', '/auth/login', { body: { email: 'alice@example.com', password: 'nope-nope-nope' } });
  const none = await req('POST', '/auth/login', { body: { email: 'nobody@example.com', password: 'nope-nope-nope' } });
  assert.equal(wrong.status, 401);
  assert.equal(none.status, 401);
  assert.equal(wrong.data.error, none.data.error, '가입 여부를 알려 주지 않는다');
  assert.equal(wrong.setCookie, null);
  assert.equal((await req('POST', '/auth/signup', { body: { email: 'alice@example.com', password: 'another-pass-1' } })).status, 409);
  assert.equal((await req('POST', '/auth/signup', { body: { email: 'short@example.com', password: '1234567' } })).status, 400);
});

test('로그인 없이 자료 API 를 열면 모두 401 (쿠키 없음·가짜 쿠키)', async () => {
  const urls = [
    ['GET', '/plans'], ['POST', '/plans'], ['GET', `/plans/${aPlan.id}`], ['PUT', `/plans/${aPlan.id}`],
    ['GET', `/plans/${aPlan.id}/tasks`], ['POST', `/plans/${aPlan.id}/tasks`], ['PATCH', `/tasks/${aTask.id}`],
    ['DELETE', `/tasks/${aTask.id}`], ['POST', `/tasks/${aTask.id}/complete`], ['POST', `/tasks/${aTask.id}/reopen`],
    ['GET', `/tasks/${aTask.id}/logs`], ['POST', `/tasks/${aTask.id}/logs`], ['GET', `/plans/${aPlan.id}/logs`],
    ['GET', `/plans/${aPlan.id}/review`], ['POST', `/plans/${aPlan.id}/reviews`], ['GET', '/reviews'], ['GET', '/export'],
    ['GET', '/auth/me'],
  ];
  for (const [m, u] of urls) {
    for (const cookie of [undefined, 'pds_sid=made-up-token-value']) {
      const r = await req(m, u, { cookie, body: m === 'GET' || m === 'DELETE' ? undefined : {} });
      assert.equal(r.status, 401, `${m} ${u} (${cookie ? '가짜 쿠키' : '쿠키 없음'})`);
      assert.doesNotMatch(JSON.stringify(r.data), /A의 비밀/);
    }
  }
  assert.equal((await req('GET', '/health')).status, 200, '상태 확인만 열려 있다');
});

test('저장된 비밀번호에 입력한 글자가 보이지 않는다 (세션 토큰도 원문 없음)', async () => {
  const [row] = await db.query("SELECT password_hash FROM users WHERE email = 'alice@example.com'");
  assert.ok(!row.password_hash.includes('alice-pass-123'));
  assert.match(row.password_hash, /^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]{24}\$[A-Za-z0-9+/=]{44}$/);
  const [other] = await db.query("SELECT password_hash FROM users WHERE email = 'bob@example.com'");
  assert.notEqual(row.password_hash.split('$')[4], other.password_hash.split('$')[4], '사람마다 소금이 다르다');
  const token = A.cookie.split('=')[1];
  const sessions = await db.query('SELECT token_hash FROM sessions');
  assert.ok(sessions.every((s) => s.token_hash !== token && /^[0-9a-f]{64}$/.test(s.token_hash)));
  // 응답으로도 비밀번호 저장값이 나가지 않는다
  const me = await req('GET', '/auth/me', { cookie: A.cookie });
  assert.deepEqual(Object.keys(me.data.user).sort(), ['email', 'id']);
  const exp = await req('GET', '/export', { cookie: A.cookie });
  assert.doesNotMatch(JSON.stringify(exp.data), /scrypt|password/);
});

test('로그아웃 뒤 같은 값으로 다시 요청하면 거절된다', async () => {
  const s = await signup('dave@example.com', 'dave-pass-000');
  assert.equal((await req('GET', '/plans', { cookie: s.cookie })).status, 200);
  assert.equal((await req('POST', '/auth/logout', { cookie: s.cookie })).status, 204);
  const again = await req('GET', '/plans', { cookie: s.cookie });
  assert.equal(again.status, 401);
  assert.equal((await req('POST', '/plans', { cookie: s.cookie, body: PLAN })).status, 401);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = 'dave@example.com'"))[0].n, 0);
});

test('기간이 지난 세션은 거절된다', async () => {
  const s = await signup('erin@example.com', 'erin-pass-111');
  await db.query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1", [s.user.id]);
  assert.equal((await req('GET', '/plans', { cookie: s.cookie })).status, 401);
});

for (const [me, them, label] of [['A', 'B', 'A → B'], ['B', 'A', 'B → A']]) {
  test(`남의 자료 읽기·수정·삭제가 거절되고 목록에도 섞이지 않는다 (${label})`, async () => {
    const who = me === 'A' ? A : B;
    const plan = them === 'A' ? aPlan : bPlan;
    const task = them === 'A' ? aTask : bTask;
    const review = them === 'A' ? aReview : bReview;
    const theirTitle = `${them}의 비밀`;
    const c = { cookie: who.cookie };
    // 읽기
    for (const u of [`/plans/${plan.id}`, `/plans/${plan.id}/tasks`, `/plans/${plan.id}/logs`, `/plans/${plan.id}/review`, `/tasks/${task.id}/logs`]) {
      const r = await req('GET', u, c);
      assert.equal(r.status, 404, `GET ${u}`);
      assert.doesNotMatch(JSON.stringify(r.data), new RegExp(theirTitle));
    }
    // 수정
    const writes = [
      ['PUT', `/plans/${plan.id}`, { ...PLAN, title: '빼앗음' }],
      ['POST', `/plans/${plan.id}/tasks`, { title: '끼워 넣기', due_date: '2026-11-07', priority: 1, estimate_minutes: 1 }],
      ['PATCH', `/tasks/${task.id}`, { title: '빼앗음' }],
      ['POST', `/tasks/${task.id}/complete`],
      ['POST', `/tasks/${task.id}/reopen`],
      ['POST', `/tasks/${task.id}/logs`, { started_at: '2026-11-06T10:00:00+09:00', ended_at: '2026-11-06T10:10:00+09:00' }],
      ['POST', `/plans/${plan.id}/reviews`, { improvement: '빼앗음' }],
      ['DELETE', `/tasks/${task.id}`],
    ];
    for (const [m, u, body] of writes) assert.equal((await req(m, u, { ...c, body })).status, 404, `${m} ${u}`);
    // 남의 돌아보기를 내 다음 계획으로 넘겨받기
    const carry = await req('POST', '/plans', { ...c, body: { ...PLAN, carried_review_id: review.id } });
    assert.equal(carry.status, 400);
    // 목록·내보내기에 섞이지 않는다
    for (const u of ['/plans', '/reviews', '/export']) {
      const r = await req('GET', u, c);
      assert.equal(r.status, 200);
      assert.doesNotMatch(JSON.stringify(r.data), new RegExp(theirTitle), u);
      assert.match(JSON.stringify(r.data), new RegExp(`${me}의 비밀`), `${u} 에 내 것은 있다`);
    }
    // 주인 쪽에서 보면 하나도 바뀌지 않았다
    const owner = them === 'A' ? A : B;
    const p = (await req('GET', `/plans/${plan.id}`, { cookie: owner.cookie })).data;
    assert.equal(p.title, `${them}의 비밀 계획`);
    assert.equal(p.version, 1);
    const ts = (await req('GET', `/plans/${plan.id}/tasks`, { cookie: owner.cookie })).data;
    assert.equal(ts.length, 1);
    assert.equal(ts[0].title, `${them}의 비밀 계획의 할 일`);
    assert.equal(ts[0].status, 'in_progress');
    assert.equal(ts[0].log_count, 1);
    assert.equal((await req('GET', `/plans/${plan.id}/review`, { cookie: owner.cookie })).data.saved.length, 1);
  });
}

test('로그인을 너무 많이 틀리면 잠시 막는다', async () => {
  await signup('frank@example.com', 'frank-pass-222');
  for (let i = 0; i < MAX_FAILS; i++) {
    assert.equal((await req('POST', '/auth/login', { body: { email: 'frank@example.com', password: `wrong-${i}` } })).status, 401);
  }
  const locked = await req('POST', '/auth/login', { body: { email: 'frank@example.com', password: 'frank-pass-222' } });
  assert.equal(locked.status, 429, '맞는 비밀번호도 잠시 막힘');
});

test('다른 사이트에서 보낸 바꾸는 요청(CSRF)은 거절된다', async () => {
  const r = await req('POST', '/plans', { cookie: A.cookie, body: PLAN, headers: { Origin: 'https://evil.example' } });
  assert.equal(r.status, 403);
  const same = await req('POST', '/plans', { cookie: A.cookie, body: { ...PLAN, title: '같은 사이트' }, headers: { Origin: base } });
  assert.equal(same.status, 201);
});

test('6번 때 넣은 주인 없는 자료는 아무에게도 안 보이고, OWNER_EMAIL 로 가입한 사람만 가져간다', async () => {
  await db.query(
    `INSERT INTO plans (id, title, start_date, end_date, priority, success_criteria, estimate_minutes)
     VALUES ('11111111-1111-4111-8111-111111111111', '6번 때 계획', '2026-11-01', '2026-11-05', 2, '옛 자료', 60)`);
  assert.doesNotMatch(JSON.stringify((await req('GET', '/plans', { cookie: A.cookie })).data), /6번 때 계획/);
  assert.equal((await req('GET', '/plans/11111111-1111-4111-8111-111111111111', { cookie: A.cookie })).status, 404);
  process.env.OWNER_EMAIL = 'owner@example.com';
  try {
    const o = await signup('owner@example.com', 'owner-pass-333');
    assert.match(JSON.stringify((await req('GET', '/plans', { cookie: o.cookie })).data), /6번 때 계획/);
    assert.doesNotMatch(JSON.stringify((await req('GET', '/plans', { cookie: o.cookie })).data), /A의 비밀|B의 비밀/, '남의 것은 안 가져감');
  } finally {
    delete process.env.OWNER_EMAIL;
  }
});

test('화면: 로그인 전에는 로그인 화면을 그리고, 비밀번호 칸은 type=password', async () => {
  const { readFile } = await import('node:fs/promises');
  const js = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(js, /if \(!me\) return renderAuth/);
  assert.match(js, /type: 'password'/);
  const html = await (await fetch(`${base}/`)).text();
  assert.match(html, /id="top-nav" hidden/, '로그인 전에는 내보내기·로그아웃 메뉴가 숨겨져 있다');
});
