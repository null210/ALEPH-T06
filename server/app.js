import express from 'express';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { authRoutes, sameOriginOnly } from './auth.js';
import { diaryRoutes } from './diary.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const TIME_ZONE = 'Asia/Seoul';

// 서울 기준 오늘 날짜 'YYYY-MM-DD'. 서버가 어느 시간대에서 돌든 결과가 같다.
export function seoulToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

// ---------- 입력 검사 ----------
class BadInput extends Error { constructor(msg) { super(msg); this.status = 400; } }
class NotFound extends Error { constructor(msg) { super(msg); this.status = 404; } }

function text(v, name, { max = 2000, optional = false } = {}) {
  if (v == null || (typeof v === 'string' && v.trim() === '')) {
    if (optional) return null;
    throw new BadInput(`${name}을(를) 적어 주세요.`);
  }
  if (typeof v !== 'string') throw new BadInput(`${name}은(는) 글자여야 합니다.`);
  const s = v.trim();
  if (s.length > max) throw new BadInput(`${name}은(는) ${max}자까지 쓸 수 있습니다.`);
  return s;
}
function date(v, name, { optional = false } = {}) {
  if (v == null || v === '') {
    if (optional) return null;
    throw new BadInput(`${name}을(를) 골라 주세요.`);
  }
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw new BadInput(`${name}은(는) YYYY-MM-DD 형식이어야 합니다.`);
  }
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
    throw new BadInput(`${name}이(가) 없는 날짜입니다.`);
  }
  return v;
}
function int(v, name, { min = 0, max = 100000, optional = false } = {}) {
  if (v == null || v === '') {
    if (optional) return null;
    throw new BadInput(`${name}을(를) 적어 주세요.`);
  }
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new BadInput(`${name}은(는) ${min}~${max} 사이의 정수여야 합니다.`);
  }
  return n;
}
function priority(v, name, opts) { return int(v, name, { min: 1, max: 3, ...opts }); }
function instant(v, name) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(v)) {
    throw new BadInput(`${name}은(는) 시간대가 붙은 ISO 8601 시각이어야 합니다.`);
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new BadInput(`${name}이(가) 올바른 시각이 아닙니다.`);
  return d.toISOString();
}
function tags(v) {
  if (v == null || v === '') return [];
  const list = Array.isArray(v) ? v : String(v).split(',');
  const out = [];
  for (const t of list) {
    if (typeof t !== 'string') throw new BadInput('태그는 글자여야 합니다.');
    const s = t.trim().replace(/^#/, '');
    if (!s) continue;
    if (s.length > 30) throw new BadInput('태그 하나는 30자까지입니다.');
    if (!out.includes(s)) out.push(s);
  }
  if (out.length > 10) throw new BadInput('태그는 10개까지입니다.');
  return out;
}
function uuid(v) {
  if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/i.test(v)) throw new NotFound('찾는 자료가 없습니다.');
  return v;
}

// ---------- 앱 ----------
export function createApp(db, { now = () => new Date() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('json spaces', 0);
  // Vercel 은 앞단에서 https 를 받아 넘겨준다. 그래야 req.secure 가 참이 되어 쿠키에 Secure 가 붙는다
  if (process.env.VERCEL) app.set('trust proxy', true);

  // 스크립트 주입을 막는 보안 헤더. 이 사이트의 파일 말고는 스크립트를 실행하지 않는다.
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
        "connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
    });
    next();
  });
  app.use(express.json({ limit: '100kb' }));

  const q = db.query;
  const api = express.Router();

  // ----- 로그인 -----
  // /api/health 와 /api/auth/* (가입·로그인·로그아웃) 말고는 모두 로그인해야 열린다.
  api.use(sameOriginOnly);
  api.get('/health', async (req, res) => {
    await q('SELECT 1');
    res.json({ ok: true, database: db.kind });
  });
  const requireUser = authRoutes(db, api);
  api.use(requireUser);
  const diary = diaryRoutes(api, db, { now, seoulToday });

  // ----- 공통 조회 (모두 "내 것" 안에서만 찾는다) -----
  // 남의 계획·할 일 ID 를 넣어도 "없다(404)"가 나온다. 주인 조건이 SQL 의 WHERE 에 들어 있기 때문이다.
  async function getPlan(id, userId) {
    const rows = await q('SELECT * FROM plans WHERE id = $1 AND user_id = $2', [uuid(id), userId]);
    if (!rows[0]) throw new NotFound('계획을 찾을 수 없습니다.');
    return rows[0];
  }
  async function getTask(id, userId) {
    const rows = await q(
      `SELECT t.* FROM tasks t JOIN plans p ON p.id = t.plan_id
        WHERE t.id = $1 AND t.deleted_at IS NULL AND p.user_id = $2`, [uuid(id), userId]);
    if (!rows[0]) throw new NotFound('할 일을 찾을 수 없습니다.');
    return rows[0];
  }
  async function planWithExtras(plan) {
    const versions = await q(
      'SELECT * FROM plan_versions WHERE plan_id = $1 ORDER BY version DESC', [plan.id]);
    let carried = null;
    if (plan.carried_review_id) {
      const r = await q(
        `SELECT r.id, r.improvement, r.created_at, p.id AS from_plan_id, p.title AS from_plan_title
           FROM reviews r JOIN plans p ON p.id = r.plan_id WHERE r.id = $1 AND p.user_id = $2`,
        [plan.carried_review_id, plan.user_id]);
      carried = r[0] ?? null;
    }
    return { ...plan, versions, carried_improvement: carried };
  }
  function planFields(b) {
    const f = {
      title: text(b.title, '계획 이름', { max: 200 }),
      start_date: date(b.start_date, '시작일'),
      end_date: date(b.end_date, '종료일'),
      priority: priority(b.priority, '우선순위'),
      success_criteria: text(b.success_criteria, '성공 기준', { max: 2000 }),
      estimate_minutes: int(b.estimate_minutes, '예상 시간(분)'),
    };
    if (f.end_date < f.start_date) throw new BadInput('종료일은 시작일보다 앞설 수 없습니다.');
    return f;
  }

  // ----- 계획 -----
  api.get('/plans', async (req, res) => {
    res.json(await q(
      `SELECT p.*,
              (SELECT count(*)::int FROM tasks t WHERE t.plan_id = p.id AND t.deleted_at IS NULL) AS task_count,
              (SELECT count(*)::int FROM tasks t WHERE t.plan_id = p.id AND t.deleted_at IS NULL AND t.status = 'done') AS done_count
         FROM plans p WHERE p.user_id = $1 ORDER BY p.start_date DESC, p.created_at DESC`, [req.user.id]));
  });

  api.post('/plans', async (req, res) => {
    const f = planFields(req.body ?? {});
    let carried = null;
    if (req.body?.carried_review_id) {
      // 남의 돌아보기를 넘겨받으면 그 사람의 고칠 점이 내 화면에 보이게 된다. 내 돌아보기만 받는다
      const r = await q(
        'SELECT r.id FROM reviews r JOIN plans p ON p.id = r.plan_id WHERE r.id = $1 AND p.user_id = $2',
        [uuid(req.body.carried_review_id), req.user.id]);
      if (!r[0]) throw new BadInput('넘겨받을 돌아보기를 찾을 수 없습니다.');
      carried = r[0].id;
    }
    const id = randomUUID();
    const [plan] = await q(
      `INSERT INTO plans (id, title, start_date, end_date, priority, success_criteria, estimate_minutes, carried_review_id, user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [id, f.title, f.start_date, f.end_date, f.priority, f.success_criteria, f.estimate_minutes, carried, req.user.id]);
    res.status(201).json(await planWithExtras(plan));
  });

  api.get('/plans/:id', async (req, res) => {
    res.json(await planWithExtras(await getPlan(req.params.id, req.user.id)));
  });

  // 고치기 전 내용을 plan_versions 에 먼저 남기고 나서 고친다
  api.put('/plans/:id', async (req, res) => {
    const f = planFields(req.body ?? {});
    const plan = await db.tx(async (t) => {
      const [cur] = await t('SELECT * FROM plans WHERE id = $1 AND user_id = $2 FOR UPDATE', [uuid(req.params.id), req.user.id]);
      if (!cur) throw new NotFound('계획을 찾을 수 없습니다.');
      await t(
        `INSERT INTO plan_versions (id, plan_id, version, title, start_date, end_date, priority, success_criteria, estimate_minutes, saved_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())`,
        [randomUUID(), cur.id, cur.version, cur.title, cur.start_date, cur.end_date, cur.priority,
          cur.success_criteria, cur.estimate_minutes]);
      const [next] = await t(
        `UPDATE plans SET title=$2, start_date=$3, end_date=$4, priority=$5, success_criteria=$6,
                estimate_minutes=$7, version = version + 1, updated_at = now()
          WHERE id = $1 RETURNING *`,
        [cur.id, f.title, f.start_date, f.end_date, f.priority, f.success_criteria, f.estimate_minutes]);
      return next;
    });
    res.json(await planWithExtras(plan));
  });

  // ----- 할 일 -----
  function taskFields(b, partial = false) {
    const f = {};
    const has = (k) => !partial || Object.hasOwn(b, k);
    if (has('title')) f.title = text(b.title, '할 일', { max: 300 });
    if (has('due_date')) f.due_date = date(b.due_date, '마감일', { optional: true });
    if (has('priority')) f.priority = priority(b.priority, '우선순위', { optional: true });
    if (has('tags')) f.tags = tags(b.tags);
    if (has('estimate_minutes')) f.estimate_minutes = int(b.estimate_minutes, '예상 시간(분)', { optional: true });
    return f;
  }
  const TASK_SELECT = `
    SELECT t.*,
           COALESCE((SELECT sum(w.actual_minutes)::int FROM work_logs w WHERE w.task_id = t.id), 0) AS actual_minutes,
           (SELECT count(*)::int FROM work_logs w WHERE w.task_id = t.id) AS log_count,
           EXISTS (SELECT 1 FROM work_logs w WHERE w.task_id = t.id
                    AND w.blocked_reason IS NOT NULL AND btrim(w.blocked_reason) <> '') AS is_blocked
      FROM tasks t`;

  api.get('/plans/:id/tasks', async (req, res) => {
    const plan = await getPlan(req.params.id, req.user.id);
    res.json(await q(`${TASK_SELECT} WHERE t.plan_id = $1 AND t.deleted_at IS NULL ORDER BY t.created_at`, [plan.id]));
  });

  api.post('/plans/:id/tasks', async (req, res) => {
    const plan = await getPlan(req.params.id, req.user.id);
    const f = taskFields(req.body ?? {});
    const id = randomUUID();
    await q(
      `INSERT INTO tasks (id, plan_id, title, due_date, priority, tags, estimate_minutes)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [id, plan.id, f.title, f.due_date, f.priority, JSON.stringify(f.tags), f.estimate_minutes]);
    res.status(201).json((await q(`${TASK_SELECT} WHERE t.id = $1`, [id]))[0]);
  });

  api.patch('/tasks/:id', async (req, res) => {
    const task = await getTask(req.params.id, req.user.id);
    const f = taskFields(req.body ?? {}, true);
    const keys = Object.keys(f);
    if (keys.length) {
      const sets = keys.map((k, i) => `${k} = $${i + 2}${k === 'tags' ? '::jsonb' : ''}`);
      const vals = keys.map((k) => (k === 'tags' ? JSON.stringify(f[k]) : f[k]));
      await q(`UPDATE tasks SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, [task.id, ...vals]);
    }
    res.json((await q(`${TASK_SELECT} WHERE t.id = $1`, [task.id]))[0]);
  });

  // 완료: 이미 완료면 아무것도 바꾸지 않는다. 동시에 두 번 와도 한 건만 남는다.
  api.post('/tasks/:id/complete', async (req, res) => {
    const { id } = await getTask(req.params.id, req.user.id); // 내 할 일이 아니면 여기서 404
    const changed = await db.tx(async (t) => {
      const rows = await t(
        `UPDATE tasks SET status = 'done', completed_at = now(), updated_at = now()
          WHERE id = $1 AND deleted_at IS NULL AND status <> 'done' RETURNING id`, [id]);
      if (!rows[0]) return false;
      await t('INSERT INTO task_completions (id, task_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [randomUUID(), id]);
      return true;
    });
    const [task] = await q(`${TASK_SELECT} WHERE t.id = $1`, [id]);
    res.json({ ...task, changed });
  });

  // 완료 되돌리기: 진행 중으로 바꾸고, 열린 완료 기록에 되돌린 시각을 적는다.
  api.post('/tasks/:id/reopen', async (req, res) => {
    const { id } = await getTask(req.params.id, req.user.id);
    const changed = await db.tx(async (t) => {
      const rows = await t(
        `UPDATE tasks SET status = 'in_progress', completed_at = NULL, updated_at = now()
          WHERE id = $1 AND deleted_at IS NULL AND status = 'done' RETURNING id`, [id]);
      if (!rows[0]) return false;
      await t('UPDATE task_completions SET reopened_at = now() WHERE task_id = $1 AND reopened_at IS NULL', [id]);
      return true;
    });
    const [task] = await q(`${TASK_SELECT} WHERE t.id = $1`, [id]);
    res.json({ ...task, changed });
  });

  // 지우기: 기록은 남기고 지운 시각만 적는다. 목록과 집계에서는 빠진다.
  api.delete('/tasks/:id', async (req, res) => {
    const task = await getTask(req.params.id, req.user.id);
    await q('UPDATE tasks SET deleted_at = now(), updated_at = now() WHERE id = $1', [task.id]);
    res.status(204).end();
  });

  // ----- 실행 기록 -----
  api.get('/tasks/:id/logs', async (req, res) => {
    const task = await getTask(req.params.id, req.user.id);
    res.json(await q('SELECT * FROM work_logs WHERE task_id = $1 ORDER BY started_at', [task.id]));
  });

  api.get('/plans/:id/logs', async (req, res) => {
    const plan = await getPlan(req.params.id, req.user.id);
    res.json(await q(
      `SELECT w.*, t.title AS task_title FROM work_logs w JOIN tasks t ON t.id = w.task_id
        WHERE t.plan_id = $1 AND t.deleted_at IS NULL ORDER BY w.started_at DESC`, [plan.id]));
  });

  api.post('/tasks/:id/logs', async (req, res) => {
    const task = await getTask(req.params.id, req.user.id);
    const b = req.body ?? {};
    const started = instant(b.started_at, '시작 시각');
    const ended = instant(b.ended_at, '끝난 시각');
    if (ended < started) throw new BadInput('끝난 시각은 시작 시각보다 앞설 수 없습니다.');
    const span = Math.round((new Date(ended) - new Date(started)) / 60000);
    const actual = b.actual_minutes == null || b.actual_minutes === ''
      ? span : int(b.actual_minutes, '실제 걸린 시간(분)');
    const id = randomUUID();
    const [log] = await q(
      `INSERT INTO work_logs (id, task_id, started_at, ended_at, actual_minutes, blocked_reason, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [id, task.id, started, ended, actual,
        text(b.blocked_reason, '막혔던 이유', { optional: true, max: 1000 }),
        text(b.note, '메모', { optional: true, max: 1000 })]);
    res.status(201).json(log);
  });

  // ----- 돌아보기 -----
  async function reviewSummary(planId) {
    const today = seoulToday(now());
    const tasks = await q(`${TASK_SELECT} WHERE t.plan_id = $1 AND t.deleted_at IS NULL ORDER BY t.created_at`, [planId]);
    const logs = await q(
      `SELECT w.id, w.actual_minutes FROM work_logs w JOIN tasks t ON t.id = w.task_id
        WHERE t.plan_id = $1 AND t.deleted_at IS NULL`, [planId]);
    const pick = (fn) => tasks.filter(fn).map((t) => t.id);
    const estimate = tasks.reduce((s, t) => s + (t.estimate_minutes ?? 0), 0);
    const actual = logs.reduce((s, l) => s + l.actual_minutes, 0);
    const ids = {
      planned: pick(() => true),
      completed: pick((t) => t.status === 'done'),
      overdue: pick((t) => t.status !== 'done' && t.due_date != null && t.due_date < today),
      blocked: pick((t) => t.is_blocked),
      logs: logs.map((l) => l.id),
    };
    return {
      today,
      time_zone: TIME_ZONE,
      planned: ids.planned.length,
      completed: ids.completed.length,
      overdue: ids.overdue.length,
      blocked: ids.blocked.length,
      estimate_minutes: estimate,
      actual_minutes: actual,
      diff_minutes: actual - estimate,
      ids,
    };
  }

  api.get('/plans/:id/review', async (req, res) => {
    const plan = await getPlan(req.params.id, req.user.id);
    const summary = await reviewSummary(plan.id);
    const saved = await q('SELECT * FROM reviews WHERE plan_id = $1 ORDER BY created_at DESC', [plan.id]);
    res.json({ ...summary, saved });
  });

  api.post('/plans/:id/reviews', async (req, res) => {
    const plan = await getPlan(req.params.id, req.user.id);
    const improvement = text(req.body?.improvement, '고칠 점', { max: 1000 });
    const { ids, ...summary } = await reviewSummary(plan.id);
    const [row] = await q(
      'INSERT INTO reviews (id, plan_id, improvement, summary) VALUES ($1,$2,$3,$4::jsonb) RETURNING *',
      [randomUUID(), plan.id, improvement, JSON.stringify(summary)]);
    res.status(201).json(row);
  });

  // 다음 계획에 넘길 수 있는 고칠 점 목록
  api.get('/reviews', async (req, res) => {
    res.json(await q(
      `SELECT r.id, r.improvement, r.created_at, p.title AS plan_title
         FROM reviews r JOIN plans p ON p.id = r.plan_id WHERE p.user_id = $1 ORDER BY r.created_at DESC`, [req.user.id]));
  });

  // ----- 내보내기: 전체 자료를 JSON 파일 하나로 -----
  api.get('/export', async (req, res) => {
    const u = [req.user.id];
    const mine = 'plan_id IN (SELECT id FROM plans WHERE user_id = $1)';
    const myTasks = `task_id IN (SELECT id FROM tasks WHERE ${mine})`;
    const data = {
      format: 'pds-export',
      schema: 'contracts/pds-schema-v2.json',
      exported_at: now().toISOString(),
      time_zone: TIME_ZONE,
      units: { estimate_minutes: 'minute', actual_minutes: 'minute' },
      user: { id: req.user.id, email: req.user.email },
      plans: await q('SELECT * FROM plans WHERE user_id = $1 ORDER BY created_at', u),
      plan_versions: await q(`SELECT * FROM plan_versions WHERE ${mine} ORDER BY plan_id, version`, u),
      tasks: await q(`SELECT * FROM tasks WHERE ${mine} ORDER BY created_at`, u),
      task_completions: await q(`SELECT * FROM task_completions WHERE ${myTasks} ORDER BY completed_at`, u),
      work_logs: await q(`SELECT * FROM work_logs WHERE ${myTasks} ORDER BY started_at`, u),
      reviews: await q(`SELECT * FROM reviews WHERE ${mine} ORDER BY created_at`, u),
      diary: await diary.load(req.user.id),
    };
    const stamp = seoulToday(now());
    res.set('Content-Disposition', `attachment; filename="pds-export-${stamp}.json"`);
    res.json(data);
  });

  app.use('/api', api);
  app.use('/api', (req, res) => res.status(404).json({ error: '없는 주소입니다.' }));

  app.use(express.static(path.join(here, '..', 'public'), { index: 'index.html' }));

  // 오류는 내부 내용(접속 주소 등)을 감추고 쉬운 말로만 돌려준다
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: '보낸 자료의 형식이 잘못되었습니다.' });
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    console.error('[error]', err.code ?? '', err.message?.split('\n')[0]);
    res.status(500).json({ error: '서버에서 문제가 생겼습니다. 잠시 뒤 다시 해 주세요.' });
  });

  return app;
}
