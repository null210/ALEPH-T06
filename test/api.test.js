// 체크리스트 항목(T06-Cxx)을 그대로 테스트 이름으로 쓴다.  npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApp, seoulToday } from '../server/app.js';

let db; let server; let base;
// 테스트 시각: 서울 2026-11-02 08:00 (= UTC 11-01 23:00). UTC 날짜와 서울 날짜가 다른 순간을 일부러 고른다.
const NOW = new Date('2026-11-01T23:00:00Z');

async function call(method, p, body) {
  const res = await fetch(`${base}/api${p}`, {
    method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body && JSON.stringify(body),
  });
  const data = res.status === 204 ? null : await res.json();
  return { status: res.status, data, headers: res.headers };
}
const ok = async (...a) => { const r = await call(...a); assert.ok(r.status < 300, `${a[0]} ${a[1]} → ${r.status} ${JSON.stringify(r.data)}`); return r.data; };

const PLAN = { title: '11월 첫 주 계획', start_date: '2026-11-01', end_date: '2026-11-07', priority: 1, success_criteria: '할 일 5개 중 4개 완료', estimate_minutes: 600 };
let plan;

before(async () => {
  db = await openDb({ dataDir: 'memory://' });
  server = createApp(db, { now: () => NOW }).listen(0);
  base = `http://localhost:${server.address().port}`;
  plan = await ok('POST', '/plans', PLAN);
});
after(async () => { server.close(); await db.close(); });

test('서울 기준 오늘 계산: UTC 11-01 23:00 은 서울 11-02', () => {
  assert.equal(seoulToday(NOW), '2026-11-02');
});

test('T06-C04~C07 계획에 기간·우선순위·성공 기준·예상 시간이 저장된다', async () => {
  const p = await ok('GET', `/plans/${plan.id}`);
  assert.match(p.id, /^[0-9a-f-]{36}$/);
  assert.equal(p.start_date, '2026-11-01');
  assert.equal(p.end_date, '2026-11-07');
  assert.equal(p.priority, 1);
  assert.equal(p.success_criteria, '할 일 5개 중 4개 완료');
  assert.equal(p.estimate_minutes, 600);
});

test('계획 입력 검사: 종료일이 시작일보다 앞서면 거절', async () => {
  const r = await call('POST', '/plans', { ...PLAN, end_date: '2026-10-01' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /종료일/);
});

test('T06-C08 계획을 고쳐도 고치기 전 계획이 그대로 남아 있다', async () => {
  const p = await ok('POST', '/plans', { ...PLAN, title: '고칠 계획' });
  const edited = await ok('PUT', `/plans/${p.id}`, { ...PLAN, title: '고친 계획', estimate_minutes: 720 });
  assert.equal(edited.version, 2);
  assert.equal(edited.title, '고친 계획');
  assert.equal(edited.versions.length, 1);
  assert.equal(edited.versions[0].version, 1);
  assert.equal(edited.versions[0].title, '고칠 계획');
  assert.equal(edited.versions[0].estimate_minutes, 600);
  const again = await ok('PUT', `/plans/${p.id}`, { ...PLAN, title: '세 번째' });
  assert.deepEqual(again.versions.map((v) => v.title), ['고친 계획', '고칠 계획']);
});

test('T06-C09~C17 할 일 만들기·고치기·완료·되돌리기·지우기, 마감일·우선순위·태그·예상 시간 저장', async () => {
  const t = await ok('POST', `/plans/${plan.id}/tasks`, { title: '보고서 초안', due_date: '2026-11-03', priority: 2, tags: '글쓰기, #학교, 글쓰기', estimate_minutes: 90 });
  assert.equal(t.due_date, '2026-11-03');
  assert.equal(t.priority, 2);
  assert.deepEqual(t.tags, ['글쓰기', '학교']);
  assert.equal(t.estimate_minutes, 90);
  assert.equal(t.status, 'in_progress');

  const e = await ok('PATCH', `/tasks/${t.id}`, { title: '보고서 초안 쓰기', tags: ['글쓰기'] });
  assert.equal(e.title, '보고서 초안 쓰기');
  assert.deepEqual(e.tags, ['글쓰기']);
  assert.equal(e.due_date, '2026-11-03', '고치지 않은 값은 그대로');

  assert.equal((await ok('POST', `/tasks/${t.id}/complete`)).status, 'done');
  assert.equal((await ok('POST', `/tasks/${t.id}/reopen`)).status, 'in_progress');

  await ok('DELETE', `/tasks/${t.id}`);
  const list = await ok('GET', `/plans/${plan.id}/tasks`);
  assert.ok(!list.some((x) => x.id === t.id));
  assert.equal((await call('PATCH', `/tasks/${t.id}`, { title: 'x' })).status, 404);
});

test('T06-C21·C22 완료를 연달아 두 번 눌러도 완료 기록은 한 건, 완료 수는 정확히 1 증가', async () => {
  const p = await ok('POST', '/plans', { ...PLAN, title: '연타 시험' });
  const t = await ok('POST', `/plans/${p.id}/tasks`, { title: '한 번만', due_date: '2026-11-05', priority: 1, estimate_minutes: 10 });
  const before = (await ok('GET', `/plans/${p.id}/review`)).completed;
  const [a, b] = await Promise.all([call('POST', `/tasks/${t.id}/complete`), call('POST', `/tasks/${t.id}/complete`)]);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal([a.data.changed, b.data.changed].filter(Boolean).length, 1);
  await ok('POST', `/tasks/${t.id}/complete`); // 세 번째
  const rows = await db.query('SELECT count(*)::int AS n FROM task_completions WHERE task_id = $1', [t.id]);
  assert.equal(rows[0].n, 1);
  assert.equal((await ok('GET', `/plans/${p.id}/review`)).completed, before + 1);
});

test('T06-C23~C27 실행 기록에 시작·끝 시각·실제 시간·막힌 이유가 저장되고 원래 계획 값은 그대로', async () => {
  const p = await ok('POST', '/plans', { ...PLAN, title: '기록 시험' });
  const t = await ok('POST', `/plans/${p.id}/tasks`, { title: '실험', due_date: '2026-11-04', priority: 1, estimate_minutes: 60 });
  const log = await ok('POST', `/tasks/${t.id}/logs`, {
    started_at: '2026-11-02T09:00:00+09:00', ended_at: '2026-11-02T10:30:00+09:00', blocked_reason: '자료가 없었음',
  });
  assert.equal(log.started_at, '2026-11-02T00:00:00.000Z');
  assert.equal(log.ended_at, '2026-11-02T01:30:00.000Z');
  assert.equal(log.actual_minutes, 90, '비워 두면 시작~끝으로 계산');
  assert.equal(log.blocked_reason, '자료가 없었음');
  const log2 = await ok('POST', `/tasks/${t.id}/logs`, { started_at: '2026-11-02T11:00:00+09:00', ended_at: '2026-11-02T12:00:00+09:00', actual_minutes: 40 });
  assert.equal(log2.actual_minutes, 40, '직접 적은 값이 우선');
  const tAfter = (await ok('GET', `/plans/${p.id}/tasks`))[0];
  assert.equal(tAfter.estimate_minutes, 60);
  assert.equal((await ok('GET', `/plans/${p.id}`)).estimate_minutes, 600);
  assert.equal((await ok('GET', `/plans/${p.id}`)).version, 1);
  const bad = await call('POST', `/tasks/${t.id}/logs`, { started_at: '2026-11-02T10:00:00+09:00', ended_at: '2026-11-02T09:00:00+09:00' });
  assert.equal(bad.status, 400);
});

test('T06-C28~C32 돌아보기 집계가 정의와 같다 (서울 날짜, 지운 할 일 제외, 지연 이중 계산 없음)', async () => {
  const p = await ok('POST', '/plans', { ...PLAN, title: '집계 시험' });
  const mk = (b) => ok('POST', `/plans/${p.id}/tasks`, { priority: 2, ...b });
  // 서울 오늘 = 2026-11-02
  const a = await mk({ title: 'A 지난 마감·미완료', due_date: '2026-11-01', estimate_minutes: 30 });   // 지연
  const b = await mk({ title: 'B 지난 마감·완료', due_date: '2026-10-30', estimate_minutes: 20 });      // 완료(지연 아님)
  const c = await mk({ title: 'C 오늘 마감·미완료', due_date: '2026-11-02', estimate_minutes: 50 });    // 오늘은 지연 아님
  const d = await mk({ title: 'D 마감 없음·예상 없음' });                                                // 합계 0 기여
  const e = await mk({ title: 'E 지움', due_date: '2026-10-01', estimate_minutes: 999 });               // 제외
  await ok('POST', `/tasks/${b.id}/complete`);
  await ok('POST', `/tasks/${e.id}/logs`, { started_at: '2026-11-01T09:00:00+09:00', ended_at: '2026-11-01T10:00:00+09:00', blocked_reason: '지운 할 일' });
  await ok('DELETE', `/tasks/${e.id}`);
  await ok('POST', `/tasks/${a.id}/logs`, { started_at: '2026-11-01T09:00:00+09:00', ended_at: '2026-11-01T09:45:00+09:00', blocked_reason: '막힘1' });
  await ok('POST', `/tasks/${a.id}/logs`, { started_at: '2026-11-01T10:00:00+09:00', ended_at: '2026-11-01T10:10:00+09:00', blocked_reason: '막힘2' });
  await ok('POST', `/tasks/${c.id}/logs`, { started_at: '2026-11-01T11:00:00+09:00', ended_at: '2026-11-01T11:20:00+09:00', blocked_reason: '   ' });

  const r = await ok('GET', `/plans/${p.id}/review`);
  assert.equal(r.today, '2026-11-02');
  assert.equal(r.planned, 4, 'C28 지우지 않은 할 일 수');
  assert.equal(r.completed, 1, 'C29 지금 완료 상태');
  assert.equal(r.overdue, 1, 'C30 미완료 + 마감일 < 오늘(서울)');
  assert.deepEqual(r.ids.overdue, [a.id]);
  assert.equal(r.blocked, 1, 'C31 막힌 이유가 하나라도 적힌 할 일 수 (기록 수 아님, 공백 제외)');
  assert.equal(r.estimate_minutes, 30 + 20 + 50, 'C32 예상 합계');
  assert.equal(r.actual_minutes, 45 + 10 + 20, 'C32 실제 = 실행 기록 합계');
  assert.equal(r.diff_minutes, 75 - 100, 'C32 차이 = 실제 − 예상');
  assert.deepEqual([r.ids.planned.length, r.ids.completed, r.ids.blocked], [4, [b.id], [a.id]], 'C83 숫자마다 출처 기록 ID');

  // 완료한 지연 할 일은 지연에서 빠진다
  await ok('POST', `/tasks/${a.id}/complete`);
  const r2 = await ok('GET', `/plans/${p.id}/review`);
  assert.equal(r2.overdue, 0);
  assert.equal(r2.completed, 2);
  assert.equal(r2.planned, 4);
});

test('T06-C32 아무것도 없으면 0', async () => {
  const p = await ok('POST', '/plans', { ...PLAN, title: '빈 계획' });
  const r = await ok('GET', `/plans/${p.id}/review`);
  assert.deepEqual([r.planned, r.completed, r.overdue, r.blocked, r.estimate_minutes, r.actual_minutes, r.diff_minutes], [0, 0, 0, 0, 0, 0, 0]);
});

test('T06-C33 돌아보기의 고칠 점 한 건이 다음 계획으로 넘어간다', async () => {
  const rv = await ok('POST', `/plans/${plan.id}/reviews`, { improvement: '예상 시간을 1.5배로 잡기' });
  assert.equal(rv.summary.planned >= 0, true);
  const next = await ok('POST', '/plans', { ...PLAN, title: '다음 주 계획', carried_review_id: rv.id });
  assert.equal(next.carried_review_id, rv.id);
  assert.equal(next.carried_improvement.improvement, '예상 시간을 1.5배로 잡기');
  assert.equal(next.carried_improvement.from_plan_id, plan.id);
});

test('T06-C35 다시 연결해도 ID·날짜·값·단위가 같은 값으로 복원된다 (파일 DB 재시작)', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pds-'));
  try {
    let d1 = await openDb({ dataDir: dir });
    let s1 = createApp(d1).listen(0);
    const u1 = `http://localhost:${s1.address().port}/api`;
    const post = (u, p, b) => fetch(u + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
    const p = await post(u1, '/plans', { ...PLAN, start_date: '2026-12-31', end_date: '2027-01-01' });
    const t = await post(u1, `/plans/${p.id}/tasks`, { title: '경계 날짜', due_date: '2026-12-31', priority: 3, tags: ['연말'], estimate_minutes: 45 });
    const l = await post(u1, `/tasks/${t.id}/logs`, { started_at: '2026-12-31T23:30:00+09:00', ended_at: '2027-01-01T00:15:00+09:00' });
    s1.close(); await d1.close();

    d1 = await openDb({ dataDir: dir });
    s1 = createApp(d1).listen(0);
    const u2 = `http://localhost:${s1.address().port}/api`;
    const p2 = await (await fetch(`${u2}/plans/${p.id}`)).json();
    const t2 = (await (await fetch(`${u2}/plans/${p.id}/tasks`)).json())[0];
    const l2 = (await (await fetch(`${u2}/tasks/${t.id}/logs`)).json())[0];
    assert.equal(p2.id, p.id);
    assert.equal(p2.start_date, '2026-12-31');
    assert.equal(p2.end_date, '2027-01-01');
    assert.equal(p2.estimate_minutes, 600);
    assert.equal(t2.id, t.id);
    assert.equal(t2.due_date, '2026-12-31');
    assert.deepEqual(t2.tags, ['연말']);
    assert.equal(t2.estimate_minutes, 45);
    assert.equal(l2.id, l.id);
    assert.equal(l2.started_at, '2026-12-31T14:30:00.000Z');
    assert.equal(l2.ended_at, '2026-12-31T15:15:00.000Z');
    assert.equal(l2.actual_minutes, 45);
    s1.close(); await d1.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('T06-C36 내 자료 전체를 파일 하나로 내보낼 수 있다', async () => {
  const r = await call('GET', '/export');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /attachment; filename="pds-export-2026-11-02\.json"/);
  for (const k of ['plans', 'plan_versions', 'tasks', 'task_completions', 'work_logs', 'reviews']) assert.ok(Array.isArray(r.data[k]), k);
  assert.ok(r.data.plans.length > 0);
  assert.equal(r.data.units.estimate_minutes, 'minute');
});

test('T06-C57 스크립트 모양 글자는 글자 그대로 저장되고, 화면 코드는 innerHTML을 쓰지 않으며 CSP가 인라인 스크립트를 막는다', async () => {
  const evil = '<script>alert(1)</script><img src=x onerror=alert(2)>';
  const t = await ok('POST', `/plans/${plan.id}/tasks`, { title: evil, due_date: '2026-11-09', priority: 3, tags: [evil.slice(0, 25)], estimate_minutes: 5 });
  assert.equal(t.title, evil);
  const page = await fetch(`${base}/`);
  const csp = page.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /unsafe-inline/);
  const js = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const code = js.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
});

test('T06-C58 브라우저로 가는 파일과 응답에 DB 접속 주소가 없다', async () => {
  for (const f of ['/', '/app.js', '/style.css']) {
    const body = await (await fetch(base + f)).text();
    assert.doesNotMatch(body, /DATABASE_URL|postgres(ql)?:\/\//i, f);
  }
  const health = await ok('GET', '/health');
  assert.deepEqual(Object.keys(health).sort(), ['database', 'ok']);
  const notFound = await call('GET', '/plans/00000000-0000-0000-0000-000000000000');
  assert.equal(notFound.status, 404);
  assert.doesNotMatch(JSON.stringify(notFound.data), /postgres|stack|at /i);
});

test('T06-C82 첫 화면에 공개 안내 문구가 있다', async () => {
  const html = await (await fetch(`${base}/`)).text();
  assert.ok(html.includes('지금은 로그인이 없어 링크를 아는 사람은 누구나 볼 수 있습니다. 남이 봐도 괜찮은 내용만 넣으세요'));
});
