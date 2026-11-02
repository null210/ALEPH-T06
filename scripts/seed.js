// 내 자료(계획 1개 + 할 일 + 실행 기록 + 돌아보기)를 한 번에 넣는 스크립트.
//   로컬 DB에:     node scripts/seed.js seed/my-data.json
//   배포한 사이트에: node scripts/seed.js seed/my-data.json https://내-사이트주소
// 화면에서 쓰는 것과 같은 API를 거치므로 같은 검사 규칙이 적용된다.
import { readFile } from 'node:fs/promises';

const [file = 'seed/my-data.json', baseArg] = process.argv.slice(2);
const data = JSON.parse(await readFile(file, 'utf8'));

let base = baseArg?.replace(/\/$/, '');
let stop = async () => {};
if (!base) {
  const { openDb } = await import('../server/db.js');
  const { createApp } = await import('../server/app.js');
  const db = await openDb();
  const server = createApp(db).listen(0);
  base = `http://localhost:${server.address().port}`;
  stop = async () => { server.close(); await db.close(); };
  console.log(`로컬 데이터베이스(${db.kind})에 넣습니다.`);
}

async function call(method, path, body) {
  const res = await fetch(`${base}/api${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body),
  });
  const out = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${out?.error ?? res.status}`);
  return out;
}

try {
  const plan = await call('POST', '/plans', data.plan);
  console.log(`계획: ${plan.title} (${plan.id})`);
  for (const t of data.tasks ?? []) {
    const { done, logs = [], ...fields } = t;
    const task = await call('POST', `/plans/${plan.id}/tasks`, fields);
    for (const l of logs) await call('POST', `/tasks/${task.id}/logs`, l);
    if (done) await call('POST', `/tasks/${task.id}/complete`);
    console.log(`  할 일: ${task.title}${done ? ' [완료]' : ''}${logs.length ? ` · 기록 ${logs.length}건` : ''}`);
  }
  if (data.plan_edit) {
    const p = await call('PUT', `/plans/${plan.id}`, { ...data.plan, ...data.plan_edit });
    console.log(`  계획을 고쳤습니다 → 버전 ${p.version} (이전 내용은 이전 버전에 남음)`);
  }
  if (data.review?.improvement) {
    await call('POST', `/plans/${plan.id}/reviews`, data.review);
    console.log(`  돌아보기 저장: ${data.review.improvement}`);
  }
  const r = await call('GET', `/plans/${plan.id}/review`);
  console.log(`돌아보기 집계: 계획 ${r.planned} · 완료 ${r.completed} · 지연 ${r.overdue} · 막힘 ${r.blocked} · 예상 ${r.estimate_minutes}분 · 실제 ${r.actual_minutes}분 · 차이 ${r.diff_minutes}분`);
} finally {
  await stop();
}
