// 5일 기록: 로그인한 사람이 "오늘(Asia/Seoul)" 기록을 하루 한 번 남기고, 2일차 뒤·3일차 앞에 계획 규칙을 하나만 바꾼다.
// 모든 조회는 experiments.user_id = 로그인한 사람 으로 묶인다.
import { randomUUID } from 'node:crypto';

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

// 화면과 제출문에 그대로 보이는 처리 규칙. 계산 코드(summarize)가 이 문장대로 동작한다.
export const FIXED_RULES = {
  missing: '값을 비워 저장한 날은 "빠짐"으로 둔다. 0으로 치지 않고 합계·평균에서 뺀다. 평균은 값이 있는 날 수로 나눈다. 아예 기록하지 않은 날은 일차로 세지 않는다.',
  duplicate: '같은 날짜에 다시 저장하면 그날 값을 새 값으로 바꾼다. 한 날짜에는 값이 하나만 남고, 고친 시각이 함께 보인다. 지난 날짜는 고칠 수 없다.',
  outlier: '튀는 값도 빼지 않고 그대로 계산한다. 같은 단계 다른 날 평균의 2배보다 크거나 절반보다 작으면 "튐" 표시만 붙인다.',
  rounding: '평균은 소수 둘째 자리에서 반올림해 첫째 자리까지 보인다(0.05 → 0.1, 반올림은 0에서 먼 쪽). 합계는 입력값 그대로 더한다.',
  week_start: '주는 월요일에 시작한다. 각 기록 옆에 그 주의 월요일 날짜를 붙인다.',
  date: '날짜는 서버가 정한 오늘(Asia/Seoul)만 쓸 수 있다. 지난 날짜나 앞 날짜로는 저장할 수 없다.',
  compare: '규칙을 바꾸기 전(1·2일차)과 바꾼 뒤(3~5일차)를 같은 지표·같은 단위·같은 계산 규칙의 평균으로 비교한다.',
};

export function round1(x) {
  if (x == null) return null;
  return (Math.sign(x) * Math.round(Math.abs(x) * 10 + 1e-9)) / 10;
}
export function mondayOf(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7; // 월=0 … 일=6
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

export function summarize(entries) {
  const phase = (name) => {
    const rows = entries.filter((e) => e.phase === name);
    const filled = rows.filter((e) => e.value != null);
    const sum = filled.reduce((s, e) => s + e.value, 0);
    return {
      days: rows.length,
      filled: filled.length,
      missing: rows.length - filled.length,
      values: rows.map((e) => e.value),
      sum: filled.length ? sum : null,
      average: filled.length ? round1(sum / filled.length) : null,
      average_raw: filled.length ? sum / filled.length : null,
    };
  };
  const before = phase('before');
  const after = phase('after');
  const outliers = [];
  for (const e of entries) {
    if (e.value == null) continue;
    const others = entries.filter((o) => o.phase === e.phase && o.id !== e.id && o.value != null);
    if (!others.length) continue;
    const m = others.reduce((s, o) => s + o.value, 0) / others.length;
    if (m > 0 && (e.value > 2 * m || e.value < m / 2)) outliers.push(e.id);
  }
  const diff = before.average_raw != null && after.average_raw != null ? round1(after.average_raw - before.average_raw) : null;
  return { before, after, diff_average: diff, outliers };
}

function text(v, name, max) {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `${name}을(를) 적어 주세요.`);
  if (v.trim().length > max) throw new HttpError(400, `${name}은(는) ${max}자까지 쓸 수 있습니다.`);
  return v.trim();
}

export function diaryRoutes(api, db, { now, seoulToday }) {
  const q = db.query;

  async function load(userId) {
    const [exp] = await q('SELECT * FROM experiments WHERE user_id = $1', [userId]);
    if (!exp) return { experiment: null, entries: [], rule_change: null };
    const entries = await q('SELECT * FROM daily_entries WHERE experiment_id = $1 ORDER BY day_no', [exp.id]);
    const [rc] = await q('SELECT * FROM rule_changes WHERE experiment_id = $1', [exp.id]);
    return { experiment: exp, entries, rule_change: rc ?? null };
  }

  api.get('/diary', async (req, res) => {
    const today = seoulToday(now());
    const d = await load(req.user.id);
    const entries = d.entries.map((e) => ({ ...e, week_monday: mondayOf(e.entry_date) }));
    const s = summarize(entries);
    const current_rule = d.rule_change ? d.rule_change.after_rule : d.experiment?.plan_rule ?? null;
    res.json({
      today,
      time_zone: 'Asia/Seoul',
      experiment: d.experiment,
      current_rule,
      entries: entries.map((e) => ({ ...e, outlier: s.outliers.includes(e.id) })),
      rule_change: d.rule_change,
      summary: s,
      today_entry: entries.find((e) => e.entry_date === today) ?? null,
      rules: FIXED_RULES,
    });
  });

  // 1일차 전에 한 번만. 다시 보내면 409 (바꿀 수 없다)
  api.post('/diary/setup', async (req, res) => {
    const b = req.body ?? {};
    const f = {
      question: text(b.question, '답하려는 질문', 300),
      metric: text(b.metric, '관찰 지표', 100),
      unit: text(b.unit, '단위', 20),
      calc_rule: text(b.calc_rule, '계산 규칙', 500),
      plan_rule: text(b.plan_rule, '처음 계획 규칙', 300),
    };
    const rows = await q(
      `INSERT INTO experiments (id, user_id, question, metric, unit, calc_rule, plan_rule)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (user_id) DO NOTHING RETURNING *`,
      [randomUUID(), req.user.id, f.question, f.metric, f.unit, f.calc_rule, f.plan_rule]);
    if (!rows[0]) throw new HttpError(409, '질문·지표·단위·규칙은 이미 정했습니다. 한 번 정하면 바꿀 수 없습니다.');
    res.status(201).json(rows[0]);
  });

  // 오늘 기록 저장(같은 날 다시 보내면 값만 바뀜)
  api.put('/diary/today', async (req, res) => {
    const today = seoulToday(now());
    const b = req.body ?? {};
    let value = null;
    if (b.value !== null && b.value !== undefined && b.value !== '') {
      value = typeof b.value === 'number' ? b.value : Number(b.value);
      if (!Number.isFinite(value) || Math.abs(value) > 1e9) throw new HttpError(400, '값은 숫자로 적어 주세요. 모르면 비워 두면 "빠짐"이 됩니다.');
    }
    const note = b.note == null || String(b.note).trim() === '' ? null : text(String(b.note), '메모', 1000);
    const out = await db.tx(async (t) => {
      const [exp] = await t('SELECT * FROM experiments WHERE user_id = $1 FOR UPDATE', [req.user.id]);
      if (!exp) throw new HttpError(400, '먼저 질문·지표·단위·규칙을 정해 주세요.');
      const [same] = await t('SELECT * FROM daily_entries WHERE experiment_id = $1 AND entry_date = $2', [exp.id, today]);
      if (same) {
        const [row] = await t(
          'UPDATE daily_entries SET value = $2, note = $3, updated_at = now() WHERE id = $1 RETURNING *', [same.id, value, note]);
        return { row, replaced: true };
      }
      const [{ n }] = await t('SELECT count(*)::int AS n FROM daily_entries WHERE experiment_id = $1', [exp.id]);
      if (n >= 5) throw new HttpError(409, '5일 기록을 모두 마쳤습니다.');
      const [rc] = await t('SELECT id FROM rule_changes WHERE experiment_id = $1', [exp.id]);
      if (n === 2 && !rc) throw new HttpError(409, '3일차를 적기 전에 계획 규칙을 하나 바꿔 주세요 (2일차 뒤·3일차 앞).');
      const [row] = await t(
        `INSERT INTO daily_entries (id, experiment_id, entry_date, day_no, value, note, phase)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [randomUUID(), exp.id, today, n + 1, value, note, rc ? 'after' : 'before']);
      return { row, replaced: false };
    });
    res.status(out.replaced ? 200 : 201).json({ ...out.row, replaced: out.replaced });
  });

  // 계획 규칙 바꾸기: 기록이 정확히 2일일 때 한 번만
  api.post('/diary/rule-change', async (req, res) => {
    const after = text(req.body?.after_rule, '바꾼 규칙', 300);
    const reason = text(req.body?.reason, '바꾼 이유', 1000);
    const row = await db.tx(async (t) => {
      const [exp] = await t('SELECT * FROM experiments WHERE user_id = $1 FOR UPDATE', [req.user.id]);
      if (!exp) throw new HttpError(400, '먼저 질문·지표·단위·규칙을 정해 주세요.');
      const [done] = await t('SELECT id FROM rule_changes WHERE experiment_id = $1', [exp.id]);
      if (done) throw new HttpError(409, '계획 규칙은 한 번만 바꿀 수 있습니다.');
      const entries = await t('SELECT id, day_no FROM daily_entries WHERE experiment_id = $1 ORDER BY day_no', [exp.id]);
      if (entries.length !== 2) throw new HttpError(409, `규칙은 2일차 기록 뒤·3일차 기록 앞에만 바꿀 수 있습니다 (지금 ${entries.length}일 기록).`);
      if (after === exp.plan_rule) throw new HttpError(400, '바꾼 규칙이 처음 규칙과 같습니다.');
      const [r] = await t(
        `INSERT INTO rule_changes (id, experiment_id, day1_entry_id, day2_entry_id, before_rule, after_rule, reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [randomUUID(), exp.id, entries[0].id, entries[1].id, exp.plan_rule, after, reason]);
      return r;
    });
    res.status(201).json(row);
  });

  return { load };
}
