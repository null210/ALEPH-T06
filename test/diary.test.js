// 7번: 로그인 → 오늘 기록(5일) → 3일차 전 규칙 변경, 그리고 비밀번호 바꾸기·계정 지우기.  npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { round1, mondayOf, summarize } from '../server/diary.js';

let db; let server; let base;
// 시계를 움직여 서로 다른 서울 날짜를 만든다. 시작: 서울 2026-11-06(금) 21:00 = UTC 12:00
let clock = new Date('2026-11-06T12:00:00Z');
const nextDay = () => { clock = new Date(clock.getTime() + 86400000); };

async function req(method, p, { body, cookie } = {}) {
  const res = await fetch(`${base}/api${p}`, {
    method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body && JSON.stringify(body),
  });
  const t = await res.text();
  return { status: res.status, data: t ? JSON.parse(t) : null, setCookie: res.headers.get('set-cookie') };
}
async function signup(email, password) {
  const r = await req('POST', '/auth/signup', { body: { email, password } });
  assert.equal(r.status, 201);
  return r.setCookie.split(';')[0];
}
const SETUP = { question: '예상 시간을 넉넉히 잡으면 실제와의 차이가 줄어드는가?', metric: '하루 예상 대비 실제 시간 차이', unit: '분', calc_rule: '그날 할 일의 실제 시간 합 − 예상 시간 합', plan_rule: '예상 시간은 떠오르는 대로 적는다' };

before(async () => {
  db = await openDb({ dataDir: 'memory://' });
  server = createApp(db, { now: () => clock }).listen(0);
  base = `http://localhost:${server.address().port}`;
});
after(async () => { server.close(); await db.close(); });

test('계산 도구: 반올림(0에서 먼 쪽, 소수 첫째 자리), 월요일 시작 주', () => {
  assert.equal(round1(47.25), 47.3);
  assert.equal(round1(0.05), 0.1);
  assert.equal(round1(-2.25), -2.3);
  assert.equal(mondayOf('2026-11-06'), '2026-11-02'); // 금
  assert.equal(mondayOf('2026-11-08'), '2026-11-02'); // 일
  assert.equal(mondayOf('2026-11-09'), '2026-11-09'); // 월
});

test('계산 도구: 빠진 값은 평균에서 빼고, 튀는 값은 표시만 한다', () => {
  const s = summarize([
    { id: 'a', phase: 'after', value: 10 }, { id: 'b', phase: 'after', value: null }, { id: 'c', phase: 'after', value: 50 },
  ]);
  assert.equal(s.after.sum, 60);
  assert.equal(s.after.filled, 2);
  assert.equal(s.after.missing, 1);
  assert.equal(s.after.average, 30);
  assert.deepEqual(s.outliers.sort(), ['a', 'c']);
});

test('로그인 없이는 오늘 기록을 읽지도 쓰지도 못한다', async () => {
  assert.equal((await req('GET', '/diary')).status, 401);
  assert.equal((await req('PUT', '/diary/today', { body: { value: 1 } })).status, 401);
});

test('로그인 → 질문·지표·단위를 한 번 정하고 → 오늘 날짜로 5일 기록, 2일차 뒤·3일차 앞에 규칙 한 번 변경', async () => {
  const me = await signup('diary@example.com', 'diary-pass-123');
  assert.equal((await req('PUT', '/diary/today', { cookie: me, body: { value: 1 } })).status, 400, '정하기 전에는 기록 불가');
  assert.equal((await req('POST', '/diary/setup', { cookie: me, body: SETUP })).status, 201);
  assert.equal((await req('POST', '/diary/setup', { cookie: me, body: { ...SETUP, unit: '시간' } })).status, 409, '한 번 정하면 못 바꿈');

  // 1일차 + 같은 날 다시 저장(중복) → 값만 바뀜
  let r = await req('PUT', '/diary/today', { cookie: me, body: { value: 40, note: '첫날' } });
  assert.equal(r.status, 201); assert.equal(r.data.day_no, 1); assert.equal(r.data.entry_date, '2026-11-06');
  r = await req('PUT', '/diary/today', { cookie: me, body: { value: 45 } });
  assert.equal(r.status, 200); assert.equal(r.data.replaced, true); assert.equal(r.data.day_no, 1);
  assert.equal((await req('POST', '/diary/rule-change', { cookie: me, body: { after_rule: 'x', reason: 'y' } })).status, 409, '1일차 뒤에는 못 바꿈');

  nextDay(); // 2일차
  assert.equal((await req('PUT', '/diary/today', { cookie: me, body: { value: 60 } })).data.day_no, 2);

  nextDay(); // 3일차 날짜인데 규칙을 안 바꿨으면 막힘
  r = await req('PUT', '/diary/today', { cookie: me, body: { value: 10 } });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /규칙/);
  r = await req('POST', '/diary/rule-change', { cookie: me, body: { after_rule: '예상 시간을 1.5배로 잡는다', reason: '이틀 모두 실제가 45분, 60분 더 걸렸다' } });
  assert.equal(r.status, 201);
  assert.equal(r.data.before_rule, SETUP.plan_rule);
  assert.equal((await req('POST', '/diary/rule-change', { cookie: me, body: { after_rule: '또', reason: '또' } })).status, 409, '한 번만');
  assert.equal((await req('PUT', '/diary/today', { cookie: me, body: { value: 20 } })).data.phase, 'after');

  nextDay(); await req('PUT', '/diary/today', { cookie: me, body: { value: null, note: '깜빡함' } }); // 4일차 빠짐
  nextDay(); await req('PUT', '/diary/today', { cookie: me, body: { value: 11 } });
  nextDay();
  assert.equal((await req('PUT', '/diary/today', { cookie: me, body: { value: 1 } })).status, 409, '6일째는 없음');

  const d = (await req('GET', '/diary', { cookie: me })).data;
  assert.deepEqual(d.entries.map((e) => e.entry_date), ['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10'], '서로 다른 서울 날짜 5일');
  assert.deepEqual(d.entries.map((e) => e.week_monday), ['2026-11-02', '2026-11-02', '2026-11-02', '2026-11-09', '2026-11-09']);
  const rc = d.rule_change;
  assert.equal(rc.day1_entry_id, d.entries[0].id);
  assert.equal(rc.day2_entry_id, d.entries[1].id);
  assert.ok(rc.changed_at > d.entries[1].created_at && rc.changed_at < d.entries[2].created_at, '2일차 뒤·3일차 앞');
  // 손으로 더한 값: 전 45+60=105, 평균 52.5 / 뒤 20+빠짐+11=31, 평균 15.5
  assert.equal(d.summary.before.sum, 105); assert.equal(d.summary.before.average, 52.5);
  assert.equal(d.summary.after.sum, 31); assert.equal(d.summary.after.average, 15.5); assert.equal(d.summary.after.missing, 1);
  assert.equal(d.summary.diff_average, -37);
  assert.equal(d.current_rule, '예상 시간을 1.5배로 잡는다');

  const exp = (await req('GET', '/export', { cookie: me })).data;
  assert.equal(exp.diary.entries.length, 5);
  assert.equal(exp.diary.rule_change.id, rc.id);
});

test('남의 5일 기록은 보이지 않는다', async () => {
  const other = await signup('other-diary@example.com', 'other-pass-123');
  const d = (await req('GET', '/diary', { cookie: other })).data;
  assert.equal(d.experiment, null);
  assert.equal(d.entries.length, 0);
});

test('비밀번호를 바꾸면 이전에 발급한 세션이 모두 끊기고, 새 비밀번호로만 로그인된다', async () => {
  const old1 = await signup('pw@example.com', 'old-password-1');
  const old2 = (await req('POST', '/auth/login', { body: { email: 'pw@example.com', password: 'old-password-1' } })).setCookie.split(';')[0];
  assert.equal((await req('POST', '/auth/password', { cookie: old1, body: { current_password: 'wrong-one-1', new_password: 'new-password-2' } })).status, 400);
  const ch = await req('POST', '/auth/password', { cookie: old1, body: { current_password: 'old-password-1', new_password: 'new-password-2' } });
  assert.equal(ch.status, 200);
  const fresh = ch.setCookie.split(';')[0];
  assert.equal((await req('GET', '/plans', { cookie: old1 })).status, 401, '바꾼 기기의 예전 쿠키');
  assert.equal((await req('GET', '/plans', { cookie: old2 })).status, 401, '다른 기기의 예전 쿠키');
  assert.equal((await req('GET', '/plans', { cookie: fresh })).status, 200);
  assert.equal((await req('POST', '/auth/login', { body: { email: 'pw@example.com', password: 'old-password-1' } })).status, 401);
  assert.equal((await req('POST', '/auth/login', { body: { email: 'pw@example.com', password: 'new-password-2' } })).status, 200);
});

test('계정을 지우면 내 자료가 모두 함께 지워지고, 남의 자료는 그대로다', async () => {
  const keep = await signup('keep@example.com', 'keep-pass-123');
  await req('POST', '/plans', { cookie: keep, body: { title: '남는 계획', start_date: '2026-11-06', end_date: '2026-11-07', priority: 1, success_criteria: 'x', estimate_minutes: 1 } });
  const me = await signup('bye@example.com', 'bye-pass-1234');
  const p = (await req('POST', '/plans', { cookie: me, body: { title: '지울 계획', start_date: '2026-11-06', end_date: '2026-11-07', priority: 1, success_criteria: 'x', estimate_minutes: 1 } })).data;
  const t = (await req('POST', `/plans/${p.id}/tasks`, { cookie: me, body: { title: '지울 할 일', due_date: '2026-11-07', priority: 1, estimate_minutes: 5 } })).data;
  await req('POST', `/tasks/${t.id}/logs`, { cookie: me, body: { started_at: '2026-11-06T09:00:00+09:00', ended_at: '2026-11-06T09:10:00+09:00' } });
  await req('POST', `/plans/${p.id}/reviews`, { cookie: me, body: { improvement: '지울 고칠 점' } });
  await req('POST', '/diary/setup', { cookie: me, body: SETUP });
  await req('PUT', '/diary/today', { cookie: me, body: { value: 3 } });

  assert.equal((await req('DELETE', '/auth/account', { cookie: me, body: { password: 'wrong-pass-1' } })).status, 400, '비밀번호가 틀리면 안 지움');
  const del = await req('DELETE', '/auth/account', { cookie: me, body: { password: 'bye-pass-1234' } });
  assert.equal(del.status, 204);
  assert.equal((await req('GET', '/plans', { cookie: me })).status, 401);
  const count = async (sql) => (await db.query(sql, [p.id]))[0].n;
  assert.equal(await count('SELECT count(*)::int AS n FROM plans WHERE id = $1'), 0);
  assert.equal(await count('SELECT count(*)::int AS n FROM tasks WHERE plan_id = $1'), 0);
  assert.equal(await count('SELECT count(*)::int AS n FROM reviews WHERE plan_id = $1'), 0);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM users WHERE email = 'bye@example.com'"))[0].n, 0);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM daily_entries e JOIN experiments x ON x.id = e.experiment_id JOIN users u ON u.id = x.user_id WHERE u.email = 'bye@example.com'"))[0].n, 0);
  assert.equal((await req('GET', '/plans', { cookie: keep })).data.length, 1, '남의 계획은 그대로');
});
