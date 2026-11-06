// "정말 안 열리는지"를 실제 요청과 응답으로 남기는 확인 스크립트.
//   로컬(빈 메모리 DB):   node scripts/verify-auth.js            > docs/evidence-local.md
//   배포한 사이트:        node scripts/verify-auth.js https://내-사이트주소 > docs/evidence-production.md
//
// - 매번 새 시험 계정 A, B 를 만든다. 둘은 일부러 "같은 무작위 비밀번호"를 쓴다(저장값이 서로 다른지 보려고).
//   진짜 계정은 쓰지 않고, 마지막에 두 계정을 모두 지운다.
// - 출력에서 비밀번호와 쿠키(세션 토큰)는 앞 5글자만 남기고 가린다 (예: pds_sid=Xk3a9…생략).
// - 로컬일 때만 DB 를 직접 읽어 비밀번호 저장값과 서버 로그를 보여 준다.
import { randomBytes } from 'node:crypto';

const baseArg = process.argv[2]?.replace(/\/$/, '');
let base = baseArg;
let db; let stop = async () => {};
// 로컬에서는 서버가 같은 프로세스에서 돈다. 서버가 찍는 로그를 모아 비밀번호 원문이 있는지 본다.
const serverLog = [];
const origLog = console.log; const origErr = console.error;
if (!base) {
  console.log = (...a) => serverLog.push(a.join(' '));
  console.error = (...a) => serverLog.push(a.join(' '));
  const { openDb } = await import('../server/db.js');
  const { createApp } = await import('../server/app.js');
  db = await openDb({ dataDir: 'memory://' });
  const server = createApp(db).listen(0);
  base = `http://localhost:${server.address().port}`;
  stop = async () => { server.close(); await db.close(); };
}

const WRONG = 'wrong-password-for-test'; // 일부러 틀리게 보내는 값. 비밀번호 칸에 들어가므로 이것도 가린다
const secrets = [WRONG];
const mask = (s) => {
  let out = String(s);
  for (const v of secrets) out = out.split(v).join(`${v.slice(0, 5)}…생략`);
  return out;
};
const lines = [];
const say = (s = '') => lines.push(mask(s));

const tag = randomBytes(3).toString('hex');
const SAME_PASSWORD = `Pw-${randomBytes(12).toString('base64url')}`;
const NEW_PASSWORD = `Nw-${randomBytes(12).toString('base64url')}`;
secrets.push(SAME_PASSWORD, NEW_PASSWORD);
const A = { name: 'A', email: `verify-a-${tag}@example.com`, password: SAME_PASSWORD };
const B = { name: 'B', email: `verify-b-${tag}@example.com`, password: SAME_PASSWORD };

let n = 0;
const failures = [];
async function call(title, method, path, { who, cookie, body, headers: extra = {}, expect, note } = {}) {
  const c = cookie ?? who?.cookie;
  const headers = { ...extra };
  if (body) headers['Content-Type'] = 'application/json';
  if (c) headers.Cookie = c;
  const res = await fetch(`${base}/api${path}`, { method, headers, body: body && JSON.stringify(body), redirect: 'manual' });
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text.slice(0, 200); }
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    const v = setCookie.split(';')[0].split('=')[1];
    if (v) secrets.push(v);
  }
  n += 1;
  const pass = expect == null || expect === res.status;
  if (!pass) failures.push(n);
  say(`#### ${n}. ${title} ${expect == null ? '' : pass ? '— ✅ 예상대로' : `— ❌ 예상 ${expect}, 실제 ${res.status}`}`);
  say('');
  say('```http');
  say(`${method} /api${path}`);
  if (c) say(`Cookie: ${c}${who ? `   ← ${who.name}의 세션` : ''}`);
  else say('Cookie: (보내지 않음)');
  for (const [k, v] of Object.entries(extra)) say(`${k}: ${v}`);
  if (body) say(`\n${JSON.stringify(body)}`);
  say('```');
  say('```http');
  say(`HTTP ${res.status}`);
  if (setCookie) say(`Set-Cookie: ${setCookie}`);
  if (data != null) say(`\n${summarize(data)}`);
  say('```');
  if (note) say(`> ${note}`);
  say('');
  return { status: res.status, data, cookie: setCookie?.split(';')[0] };
}
// 긴 응답은 확인에 필요한 부분만 남긴다
function summarize(d) {
  if (Array.isArray(d)) return `[ ${d.length}건 ] ${JSON.stringify(d.map((x) => x.title ?? x.improvement ?? x.id))}`;
  if (d && d.format === 'pds-export') {
    return JSON.stringify({ user: d.user, plans: d.plans.map((p) => p.title), tasks: d.tasks.map((t) => t.title), reviews: d.reviews.map((r) => r.improvement), diary_entries: d.diary.entries.length });
  }
  if (d && d.versions) return JSON.stringify({ id: d.id, title: d.title, user_id: d.user_id, version: d.version });
  return JSON.stringify(d);
}
// 주인이 보는 자기 자료 건수 (계획 수, 첫 계획의 할 일 수와 이름·상태)
async function countOf(who, planId) {
  const get = (p) => fetch(`${base}/api${p}`, { headers: { Cookie: who.cookie } }).then((r) => r.json());
  const plans = await get('/plans');
  const tasks = await get(`/plans/${planId}/tasks`);
  const reviews = await get('/reviews');
  return { 계획: plans.length, 할일: tasks.length, 돌아보기: reviews.length, 할일_상태: tasks.map((t) => `${t.title}/${t.status}`).join(', ') };
}

const PLAN = { start_date: '2026-11-06', end_date: '2026-11-10', priority: 1, success_criteria: '확인용', estimate_minutes: 60 };

try {
  say(`# 인증 확인 기록 (${baseArg ? '배포 사이트' : '로컬 서버, 빈 메모리 DB'})`);
  say('');
  say(`- 실행 시각: ${new Date().toISOString()} (UTC)`);
  say(`- 대상: ${baseArg ?? 'http://localhost:(임시 포트)'}`);
  say(`- 시험 계정: A = ${A.email}, B = ${B.email}. 이번 실행에서 새로 만들었고, 마지막(ㅈ)에 둘 다 지웠습니다.`);
  say('- A와 B는 일부러 **같은 비밀번호**로 만들었습니다(ㅇ에서 저장값이 서로 다른지 봅니다).');
  say('- 가린 값: 비밀번호와 세션 쿠키는 앞 5글자만 남기고 "…생략"으로 가렸습니다. 비밀번호 원문은 이 문서 어디에도 없습니다.');
  say('');

  // ---------------------------------------------------------------
  say('### ㄱ. 가입·로그인 (같은 이메일 두 번 가입, 틀린 비밀번호, 없는 이메일)');
  say('');
  const sa = await call('A 가입', 'POST', '/auth/signup', { body: { email: A.email, password: A.password }, expect: 201 });
  A.cookie = sa.cookie; A.id = sa.data.user.id;
  const sb = await call('B 가입 (A와 같은 비밀번호)', 'POST', '/auth/signup', { body: { email: B.email, password: B.password }, expect: 201 });
  B.cookie = sb.cookie; B.id = sb.data.user.id;
  // 같은 비밀번호로 만든 두 계정의 저장값을 바로 이때 찍어 둔다 (A가 나중에 비밀번호를 바꾸기 전)
  const hashesAtSignup = db
    ? await db.query('SELECT email, password_hash FROM users WHERE email = ANY($1) ORDER BY email', [[A.email, B.email]])
    : null;
  await call('같은 이메일로 다시 가입 → 거절', 'POST', '/auth/signup', { body: { email: A.email, password: A.password }, expect: 409 });
  await call('A 이메일 + 틀린 비밀번호로 로그인 → 거절', 'POST', '/auth/login', { body: { email: A.email, password: WRONG }, expect: 401 });
  await call('없는 이메일로 로그인 → 위와 같은 문장으로 거절', 'POST', '/auth/login', { body: { email: `nobody-${tag}@example.com`, password: WRONG }, expect: 401 });
  const la = await call('A 맞는 비밀번호로 로그인 → 새 세션', 'POST', '/auth/login', { body: { email: A.email, password: A.password }, expect: 200 });
  const signupCookieA = A.cookie;
  A.cookie = la.cookie;

  // ---------------------------------------------------------------
  say('### ㄴ. [확인 1] 로그인 없이 자료 요청 — 성공(로그인함)과 거절(로그인 안 함)');
  say('');
  await call('[성공] A의 쿠키로 계획 목록', 'GET', '/plans', { who: A, expect: 200 });
  await call('[거절] 같은 주소, 쿠키 없이', 'GET', '/plans', { expect: 401 });
  await call('[거절] 쿠키 없이 전체 내보내기', 'GET', '/export', { expect: 401 });
  await call('[거절] 쿠키 없이 오늘 기록 쓰기', 'PUT', '/diary/today', { body: { value: 1 }, expect: 401 });
  await call('[거절] 지어낸 쿠키로 계획 목록', 'GET', '/plans', { cookie: 'pds_sid=not-a-real-token', expect: 401 });

  // ---------------------------------------------------------------
  say('### ㄷ. 두 계정에 자료 넣기 (성공해야 정상)');
  say('');
  const ap = (await call('A가 계획 만들기', 'POST', '/plans', { who: A, body: { ...PLAN, title: 'A의 비밀 계획' }, expect: 201 })).data;
  const at = (await call('A가 할 일 만들기', 'POST', `/plans/${ap.id}/tasks`, { who: A, body: { title: 'A의 할 일', due_date: '2026-11-07', priority: 2, estimate_minutes: 30 }, expect: 201 })).data;
  await call('A가 돌아보기 저장', 'POST', `/plans/${ap.id}/reviews`, { who: A, body: { improvement: 'A의 고칠 점' }, expect: 201 });
  const bp = (await call('B가 계획 만들기', 'POST', '/plans', { who: B, body: { ...PLAN, title: 'B의 비밀 계획' }, expect: 201 })).data;
  const bt = (await call('B가 할 일 만들기', 'POST', `/plans/${bp.id}/tasks`, { who: B, body: { title: 'B의 할 일', due_date: '2026-11-07', priority: 2, estimate_minutes: 30 }, expect: 201 })).data;
  const br = (await call('B가 돌아보기 저장', 'POST', `/plans/${bp.id}/reviews`, { who: B, body: { improvement: 'B의 고칠 점' }, expect: 201 })).data;
  const ar = (await call('A의 고칠 점 목록 (A 것 1건)', 'GET', '/reviews', { who: A, expect: 200 })).data[0];

  // ---------------------------------------------------------------
  const before = { A: await countOf(A, ap.id), B: await countOf(B, bp.id) };
  for (const [me, plan, task, review, them] of [[A, bp, bt, br, B], [B, ap, at, ar, A]]) {
    say(`### ㄹ. [확인 2] ${me.name}가 ${them.name}의 자료 읽기·고치기·지우기 → 모두 거절 (${me.name} → ${them.name})`);
    say('');
    await call(`[성공] 주인 ${them.name}가 자기 계획 읽기`, 'GET', `/plans/${plan.id}`, { who: them, expect: 200 });
    await call(`[거절·읽기] ${me.name}가 같은 주소로 ${them.name} 계획 읽기`, 'GET', `/plans/${plan.id}`, { who: me, expect: 404 });
    await call(`[거절·읽기] ${me.name}가 ${them.name} 할 일 목록 읽기`, 'GET', `/plans/${plan.id}/tasks`, { who: me, expect: 404 });
    await call(`[성공] 주인 ${them.name}가 자기 할 일 이름 바꾸기 (같은 이름으로 다시 저장)`, 'PATCH', `/tasks/${task.id}`, { who: them, body: { title: task.title }, expect: 200 });
    await call(`[거절·고치기] ${me.name}가 같은 주소로 ${them.name} 할 일 이름 바꾸기`, 'PATCH', `/tasks/${task.id}`, { who: me, body: { title: '빼앗음' }, expect: 404 });
    await call(`[거절·고치기] ${me.name}가 ${them.name} 계획 고치기`, 'PUT', `/plans/${plan.id}`, { who: me, body: { ...PLAN, title: '빼앗음' }, expect: 404 });
    await call(`[거절·고치기] ${me.name}가 ${them.name} 할 일 완료 누르기`, 'POST', `/tasks/${task.id}/complete`, { who: me, expect: 404 });
    await call(`[거절·고치기] ${me.name}가 ${them.name} 계획에 할 일 끼워 넣기`, 'POST', `/plans/${plan.id}/tasks`, { who: me, body: { title: '끼워 넣기', due_date: '2026-11-07', priority: 1, estimate_minutes: 1 }, expect: 404 });
    await call(`[거절·지우기] ${me.name}가 ${them.name} 할 일 지우기`, 'DELETE', `/tasks/${task.id}`, { who: me, expect: 404 });
    await call(`[거절] ${me.name}가 ${them.name}의 돌아보기를 내 다음 계획으로 넘겨받기`, 'POST', '/plans', { who: me, body: { ...PLAN, title: '넘겨받기 시도', carried_review_id: review.id }, expect: 400 });
    await call(`${me.name}의 계획 목록 — ${them.name} 것이 하나도 없음`, 'GET', '/plans', { who: me, expect: 200 });
    await call(`${me.name}의 고칠 점 목록 — ${them.name} 것이 하나도 없음`, 'GET', '/reviews', { who: me, expect: 200 });
    await call(`${me.name}의 전체 내보내기 — ${them.name} 것이 하나도 없음`, 'GET', '/export', { who: me, expect: 200 });
  }
  const after = { A: await countOf(A, ap.id), B: await countOf(B, bp.id) };
  say('#### 거절 앞뒤로 센 자료 건수 (주인이 자기 쿠키로 센 값)');
  say('');
  say('| 계정 | 거절 전 | 거절 후 | 같은가 |');
  say('|---|---|---|---|');
  for (const k of ['A', 'B']) {
    const same = JSON.stringify(before[k]) === JSON.stringify(after[k]);
    if (!same) failures.push(`count-${k}`);
    say(`| ${k} | ${JSON.stringify(before[k])} | ${JSON.stringify(after[k])} | ${same ? '✅ 같음' : '❌ 다름'} |`);
  }
  say('');

  // ---------------------------------------------------------------
  say(`### ㅁ. [확인 3] 주소·헤더·본문에 다른 계정(B의 id ${B.id})을 적어 보내기 → 그래도 A 자료만`);
  say('');
  await call('주소(쿼리)에 B의 id', 'GET', `/plans?user_id=${B.id}`, { who: A, expect: 200 });
  await call('요청 헤더에 B의 id', 'GET', '/plans', { who: A, headers: { 'X-User-Id': B.id }, expect: 200 });
  const spoof = await call('요청 본문에 B의 id를 넣어 계획 만들기', 'POST', '/plans', { who: A, body: { ...PLAN, title: 'A가 B 이름으로 만들려던 계획', user_id: B.id }, expect: 201,
    note: '본문의 user_id 는 무시되고 로그인한 A의 계획으로 만들어집니다(응답의 user_id 를 보세요).' });
  await call('B의 계획 목록 — 위 계획이 B에게 생기지 않음', 'GET', '/plans', { who: B, expect: 200 });
  if (spoof.data?.user_id !== A.id) failures.push('spoof-owner');

  // ---------------------------------------------------------------
  say('### ㅂ. [확인 4] 로그아웃 뒤 같은 값으로 다시 요청 → 거절 (같은 주소·같은 방식)');
  say('');
  await call('[성공] 로그아웃 전: A의 쿠키로 GET /api/plans', 'GET', '/plans', { who: A, expect: 200 });
  await call('A 로그아웃', 'POST', '/auth/logout', { who: A, expect: 204 });
  await call('[거절] 로그아웃 뒤: 똑같은 쿠키 값으로 GET /api/plans', 'GET', '/plans', { cookie: A.cookie, expect: 401 });
  await call('[거절] 로그아웃 뒤: 똑같은 쿠키 값으로 계획 만들기', 'POST', '/plans', { cookie: A.cookie, body: { ...PLAN, title: '로그아웃 뒤' }, expect: 401 });

  // ---------------------------------------------------------------
  say('### ㅅ. [확인 5] 비밀번호를 바꾸면 이전에 발급한 값이 더는 통하지 않음 (같은 주소·같은 방식)');
  say('');
  await call('[성공] 바꾸기 전: A가 가입할 때 받은 쿠키로 GET /api/plans', 'GET', '/plans', { cookie: signupCookieA, expect: 200 });
  const ch = await call('A 비밀번호 바꾸기 (이 쿠키로 요청)', 'POST', '/auth/password', { cookie: signupCookieA, body: { current_password: A.password, new_password: NEW_PASSWORD }, expect: 200 });
  A.password = NEW_PASSWORD; A.cookie = ch.cookie;
  await call('[거절] 바꾼 뒤: 똑같은 예전 쿠키 값으로 GET /api/plans', 'GET', '/plans', { cookie: signupCookieA, expect: 401 });
  await call('[성공] 바꿀 때 새로 받은 쿠키로 GET /api/plans', 'GET', '/plans', { who: A, expect: 200 });
  await call('[거절] 예전 비밀번호로 로그인', 'POST', '/auth/login', { body: { email: A.email, password: SAME_PASSWORD }, expect: 401 });

  // ---------------------------------------------------------------
  say('### ㅇ. 비밀번호 저장값');
  say('');
  if (db) {
    const rows = hashesAtSignup;
    say('두 계정을 **같은 비밀번호**로 가입한 직후 DB 를 직접 읽은 값입니다(가리지 않고 그대로 옮김). 저장값은 비밀번호를 되돌릴 수 없게 바꾼 결과라 원문이 아닙니다.');
    say('형식: `scrypt$N$r$p$소금(16바이트, base64)$결과(32바이트, base64)`');
    say('');
    say('```sql');
    say('SELECT email, password_hash FROM users ORDER BY email;   -- B 가입 직후');
    say('```');
    say('```text');
    for (const r of rows) say(`${r.email} | ${r.password_hash}`);
    say('```');
    const [ha, hb] = rows.map((r) => r.password_hash);
    if (ha === hb) failures.push('same-hash');
    say(`- 같은 비밀번호인데 두 저장값이 서로 다른가? → **${ha !== hb ? '다름 ✅' : '같음 ❌'}** (소금이 다름: \`${ha.split('$')[4]}\` vs \`${hb.split('$')[4]}\`)`);
    say(`- 입력한 비밀번호 글자가 저장값 안에 들어 있나? → **${rows.some((r) => r.password_hash.includes(SAME_PASSWORD)) ? '예 ❌' : '아니오 ✅'}**`);
    const [{ total, raw }] = await db.query(
      'SELECT count(*)::int AS total, count(*) FILTER (WHERE token_hash = ANY($1))::int AS raw FROM sessions',
      [secrets.filter((s) => s.length === 43)]);
    say(`- 지금 남은 세션 행 ${total}개, 그중 쿠키 원문과 같은 값이 저장된 행 **${raw}개** (SHA-256 값만 저장)`);
    say('');
  } else {
    say('(배포 사이트에서는 DB 를 직접 읽지 않습니다. 로컬 기록의 ㅇ을 보세요.)');
    say('');
  }

  // ---------------------------------------------------------------
  say('### ㅈ. 계정 지우기 (시험 계정 정리 겸 확인)');
  say('');
  await call('A 계정 지우기 (틀린 비밀번호) → 거절', 'DELETE', '/auth/account', { who: A, body: { password: WRONG }, expect: 400 });
  await call('A 계정 지우기', 'DELETE', '/auth/account', { who: A, body: { password: A.password }, expect: 204 });
  await call('[거절] 지운 뒤 같은 쿠키로 계획 목록', 'GET', '/plans', { cookie: A.cookie, expect: 401 });
  await call('[거절] 지운 계정으로 로그인', 'POST', '/auth/login', { body: { email: A.email, password: A.password }, expect: 401 });
  await call('B의 계획은 그대로', 'GET', '/plans', { who: B, expect: 200 });
  await call('B 계정 지우기 (정리)', 'DELETE', '/auth/account', { who: B, body: { password: B.password }, expect: 204 });

  if (db) {
    say('### ㅊ. 서버 로그');
    say('');
    const leaked = serverLog.filter((l) => secrets.some((s) => l.includes(s)));
    say(`- 이번 실행 동안 서버가 찍은 로그 ${serverLog.length}줄 가운데 비밀번호·쿠키 원문이 들어 있는 줄: **${leaked.length}줄**`);
    say('- 서버는 요청 본문을 로그로 찍지 않습니다. 찍는 것은 500 오류의 코드와 첫 줄뿐입니다 (server/app.js 마지막 오류 처리기).');
    say('');
    if (leaked.length) failures.push('log');
  }
  say(failures.length ? `**결과: 예상과 다른 응답이 있었습니다: ${failures.join(', ')}**` : `**결과: ${n}개 요청이 모두 예상한 상태 코드로 응답했고, 거절 앞뒤 건수도 같았습니다.**`);
  if (failures.length) process.exitCode = 1;
} finally {
  await stop();
  console.log = origLog; console.error = origErr;
  console.log(lines.join('\n'));
}
