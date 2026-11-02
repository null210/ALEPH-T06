// PDS 플래너 화면.
// 안전 규칙: 사용자가 쓴 글은 모두 textContent 로만 넣는다. innerHTML 을 쓰지 않으므로
// "<script>" 같은 글자를 저장해도 실행되지 않고 글자 그대로 보인다.

const TZ = 'Asia/Seoul';
const PRI = { 1: '높음', 2: '보통', 3: '낮음' };
const app = document.getElementById('app');

// ---------- 작은 도구 ----------
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

async function api(method, url, body) {
  const res = await fetch(`/api${url}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch { /* 빈 응답 */ }
  if (!res.ok) throw new Error(data?.error ?? `요청이 실패했습니다 (${res.status}).`);
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = isError ? 'toast err' : 'toast';
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 5000 : 2500);
}

const seoulToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
function fmtDate(d) {
  if (!d) return '';
  return `${d} (${WEEK[new Date(`${d}T00:00:00Z`).getUTCDay()]})`;
}
function fmtTime(iso) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
// <input type="datetime-local"> 값은 서울 시각으로 읽는다
const localToInstant = (v) => `${v}:00+09:00`;
function nowLocalSeoul(offsetMin = 0) {
  return fmtTime(new Date(Date.now() + offsetMin * 60000).toISOString()).replace(' ', 'T');
}
function fmtMin(m) {
  if (m == null) return '';
  const a = Math.abs(m); const hh = Math.floor(a / 60); const mm = a % 60;
  const long = hh ? ` (${hh}시간${mm ? ` ${mm}분` : ''})` : '';
  return `${m}분${long}`;
}
const signed = (m) => (m > 0 ? `+${m}` : m < 0 ? `−${Math.abs(m)}` : '0');

function formData(form) {
  const out = {};
  for (const [k, v] of new FormData(form)) out[k] = typeof v === 'string' ? v.trim() : v;
  return out;
}
function numOrNull(v) { return v === '' || v == null ? null : Number(v); }

// 같은 요청을 연달아 보내지 않도록 버튼을 잠근다
async function busy(btn, fn) {
  if (btn.disabled) return;
  btn.disabled = true;
  try { return await fn(); } finally { btn.disabled = false; }
}

function errorLine() { return h('p', { class: 'form-error', role: 'alert', hidden: true }); }
function showError(el, e) { el.textContent = e.message; el.hidden = false; }

function field(label, input, cls) { return h('label', { class: `field ${cls ?? ''}` }, label, input); }
function prioritySelect(name, value, { allowEmpty = false, id } = {}) {
  return h('select', { name, id, required: !allowEmpty },
    allowEmpty ? h('option', { value: '' }, '없음') : null,
    [1, 2, 3].map((p) => h('option', { value: p, selected: Number(value) === p }, `${p} · ${PRI[p]}`)));
}

// ---------- 라우터 ----------
function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [p, qs] = raw.split('?');
  const parts = p.split('/').filter(Boolean);
  return { parts, params: new URLSearchParams(qs ?? '') };
}

async function route() {
  const { parts, params } = parseHash();
  app.replaceChildren(h('p', { class: 'loading' }, '불러오는 중…'));
  try {
    if (parts[0] === 'plan' && parts[1]) await renderPlan(parts[1], parts[2] ?? 'tasks', params);
    else await renderHome(params);
  } catch (e) {
    app.replaceChildren(h('div', { class: 'panel' },
      h('h1', {}, '화면을 열 수 없습니다'), h('p', {}, e.message), h('p', {}, h('a', { href: '#/' }, '계획 목록으로 가기'))));
  }
}
window.addEventListener('hashchange', route);
route();

// ---------- 첫 화면: 계획 목록 + 새 계획 ----------
async function renderHome(params) {
  const [plans, reviews] = await Promise.all([api('GET', '/plans'), api('GET', '/reviews')]);
  document.title = 'PDS 플래너';

  const list = plans.length
    ? h('ul', { class: 'plan-list' }, plans.map((p) => h('li', {},
      h('a', { class: 'plan-link', href: `#/plan/${p.id}` },
        h('span', { class: 't' }, p.title),
        h('span', { class: 'meta' }, `${p.start_date} ~ ${p.end_date} · 우선순위 ${PRI[p.priority]} · 예상 ${fmtMin(p.estimate_minutes)}`),
        h('span', { class: 'prog' }, h('b', { class: 'num' }, `${p.done_count}/${p.task_count}`), '완료')))))
    : h('p', { class: 'empty' }, '아직 계획이 없습니다. 오른쪽에서 첫 계획을 세워 보세요.');

  app.replaceChildren(
    h('div', { class: 'home' },
      h('section', { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h1', {}, '내 계획'), h('span', { class: 'hint' }, `${plans.length}개`)),
        list),
      planForm({ reviews, carry: params.get('carry') })));
}

function planForm({ plan, reviews, carry, onSaved }) {
  const editing = !!plan;
  const today = seoulToday();
  const err = errorLine();
  const form = h('form', { class: 'form-grid', novalidate: true },
    field('계획 이름', h('input', { name: 'title', id: 'plan-title', required: true, maxlength: 200, value: plan?.title ?? '' }), 'wide'),
    field('시작일', h('input', { type: 'date', name: 'start_date', id: 'plan-start', required: true, value: plan?.start_date ?? today })),
    field('종료일', h('input', { type: 'date', name: 'end_date', id: 'plan-end', required: true, value: plan?.end_date ?? '' })),
    field('우선순위', prioritySelect('priority', plan?.priority ?? 2, { id: 'plan-priority' })),
    field('예상 시간 (분)', h('input', { type: 'number', name: 'estimate_minutes', id: 'plan-estimate', min: 0, step: 1, required: true, inputmode: 'numeric', value: plan?.estimate_minutes ?? '' })),
    field('성공 기준', h('textarea', { name: 'success_criteria', id: 'plan-success', required: true, maxlength: 2000, placeholder: '무엇이 되면 이 계획이 성공인가요?' }, plan?.success_criteria ?? ''), 'wide'),
    !editing && reviews?.length
      ? field('지난 돌아보기에서 넘겨받을 고칠 점 (한 건)', h('select', { name: 'carried_review_id', id: 'plan-carry' },
        h('option', { value: '' }, '넘겨받지 않음'),
        reviews.map((r) => h('option', { value: r.id, selected: r.id === carry }, `${r.plan_title} → ${r.improvement}`))), 'wide')
      : null,
    h('div', { class: 'form-actions wide' },
      h('button', { class: 'btn', type: 'submit' }, editing ? '고친 내용 저장' : '계획 만들기'),
      editing ? h('span', { class: 'hint' }, `저장하면 지금 내용(버전 ${plan.version})은 아래 "이전 버전"에 그대로 남습니다.`) : null),
    err);

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    busy(btn, async () => {
      err.hidden = true;
      const d = formData(form);
      const body = { ...d, priority: Number(d.priority), estimate_minutes: numOrNull(d.estimate_minutes) };
      if (!body.carried_review_id) delete body.carried_review_id;
      try {
        const saved = editing ? await api('PUT', `/plans/${plan.id}`, body) : await api('POST', '/plans', body);
        toast(editing ? `저장했습니다. 이전 내용은 버전 ${saved.version - 1}로 남았습니다.` : '계획을 만들었습니다.');
        if (onSaved) onSaved(saved); else location.hash = `#/plan/${saved.id}`;
      } catch (e) { showError(err, e); }
    });
  });

  if (editing) return form;
  return h('section', { class: 'panel' }, h('h2', {}, '새 계획 세우기'),
    h('p', { class: 'hint' }, '계획에는 ID(자동), 기간, 우선순위, 성공 기준, 예상 시간을 저장합니다.'), form);
}

// ---------- 계획 화면 ----------
const TABS = [['tasks', '할 일'], ['logs', '실행 기록'], ['review', '돌아보기'], ['edit', '계획 고치기 · 이전 버전']];

async function renderPlan(id, tab, params) {
  const plan = await api('GET', `/plans/${id}`);
  document.title = `${plan.title} · PDS 플래너`;
  const head = h('section', { class: 'plan-head' },
    h('div', { class: 'crumb' }, h('a', { href: '#/' }, '계획 목록'), ' / ', h('span', { class: 'mono' }, `ID ${plan.id.slice(0, 8)}`), ` · 버전 ${plan.version}`),
    h('h1', {}, plan.title),
    h('dl', { class: 'facts' },
      h('div', {}, h('dt', {}, '기간'), h('dd', {}, `${fmtDate(plan.start_date)} ~ ${fmtDate(plan.end_date)}`)),
      h('div', {}, h('dt', {}, '우선순위'), h('dd', {}, `${plan.priority} · ${PRI[plan.priority]}`)),
      h('div', {}, h('dt', {}, '예상 시간'), h('dd', { class: 'num' }, fmtMin(plan.estimate_minutes))),
      h('div', { class: 'span' }, h('dt', {}, '성공 기준'), h('dd', {}, plan.success_criteria))),
    plan.carried_improvement
      ? h('p', { class: 'carried' }, h('b', {}, '지난 돌아보기에서 넘겨받은 고칠 점: '), plan.carried_improvement.improvement,
        h('span', { class: 'hint' }, ` (${plan.carried_improvement.from_plan_title})`))
      : null,
    h('nav', { class: 'tabs', 'aria-label': '계획 화면' },
      TABS.map(([k, label]) => h('a', { href: `#/plan/${plan.id}/${k}`, 'aria-current': k === tab ? 'page' : null }, label))));

  const body = h('div', {});
  app.replaceChildren(head, body);
  if (tab === 'logs') await logsView(plan, params, body);
  else if (tab === 'review') await reviewView(plan, body);
  else if (tab === 'edit') editView(plan, body);
  else await tasksView(plan, params, body);
}

// ---------- 할 일 ----------
const SORTS = {
  due: { label: '마감일 빠른 순', rule: '마감일 빠른 순 → 같으면 우선순위 높은 순 → 같으면 먼저 만든 순. 마감일 없는 할 일은 맨 뒤.' },
  priority: { label: '우선순위 높은 순', rule: '우선순위 높은 순(1→3) → 같으면 마감일 빠른 순 → 같으면 먼저 만든 순. 우선순위 없는 할 일은 맨 뒤.' },
  created: { label: '최근 만든 순', rule: '만든 시각이 최근인 것부터.' },
  estimate: { label: '예상 시간 긴 순', rule: '예상 시간 긴 순 → 같으면 마감일 빠른 순. 예상 시간 없는 할 일은 맨 뒤.' },
};
const cmpNullLast = (a, b, dir = 1) => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : (a < b ? -1 : a > b ? 1 : 0) * dir);
function sortTasks(list, key) {
  const by = {
    due: (a, b) => cmpNullLast(a.due_date, b.due_date) || cmpNullLast(a.priority, b.priority) || cmpNullLast(a.created_at, b.created_at),
    priority: (a, b) => cmpNullLast(a.priority, b.priority) || cmpNullLast(a.due_date, b.due_date) || cmpNullLast(a.created_at, b.created_at),
    created: (a, b) => cmpNullLast(a.created_at, b.created_at, -1),
    estimate: (a, b) => cmpNullLast(a.estimate_minutes, b.estimate_minutes, -1) || cmpNullLast(a.due_date, b.due_date),
  }[key];
  return [...list].sort(by);
}

const FOCUS_LABEL = {
  planned: '돌아보기의 "계획"에 들어간 할 일',
  completed: '돌아보기의 "완료"에 들어간 할 일',
  overdue: '돌아보기의 "지연"에 들어간 할 일',
  blocked: '돌아보기의 "막힘"에 들어간 할 일',
  estimate: '돌아보기의 "예상 시간" 합계에 들어간 할 일',
};

function taskFormFields(t = {}, idp = 'new') {
  return [
    field('할 일', h('input', { name: 'title', id: `${idp}-title`, required: true, maxlength: 300, value: t.title ?? '' }), 'wide'),
    field('마감일', h('input', { type: 'date', name: 'due_date', id: `${idp}-due`, required: true, value: t.due_date ?? '' })),
    field('우선순위', prioritySelect('priority', t.priority ?? 2, { id: `${idp}-pri` })),
    field('태그 (쉼표로 구분)', h('input', { name: 'tags', id: `${idp}-tags`, placeholder: '예: 공부, 집', value: (t.tags ?? []).join(', ') })),
    field('예상 시간 (분)', h('input', { type: 'number', name: 'estimate_minutes', id: `${idp}-est`, min: 0, step: 1, inputmode: 'numeric', required: true, value: t.estimate_minutes ?? '' })),
  ];
}
function taskBody(form) {
  const d = formData(form);
  return { title: d.title, due_date: d.due_date || null, priority: numOrNull(d.priority), tags: d.tags, estimate_minutes: numOrNull(d.estimate_minutes) };
}

async function tasksView(plan, params, root) {
  let tasks = await api('GET', `/plans/${plan.id}/tasks`);
  const ui = { q: '', status: '', pri: '', tag: '', late: false, blocked: false, sort: 'due', open: {}, focus: null };
  try { ui.sort = localStorage.getItem('pds-sort') || 'due'; } catch { /* 저장소 없음 */ }
  if (!SORTS[ui.sort]) ui.sort = 'due';

  const show = params.get('show');
  if (show && FOCUS_LABEL[show]) {
    const r = await api('GET', `/plans/${plan.id}/review`);
    const ids = show === 'estimate' ? r.ids.planned : r.ids[show];
    ui.focus = { label: FOCUS_LABEL[show], ids: new Set(ids) };
  }
  const flashId = params.get('task');
  if (flashId) ui.open[flashId] = 'logs';

  // 새 할 일
  const addErr = errorLine();
  const addForm = h('form', { class: 'form-grid', novalidate: true }, taskFormFields({}, 'new'),
    h('div', { class: 'form-actions wide' }, h('button', { class: 'btn', type: 'submit' }, '할 일 추가')), addErr);
  addForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    busy(addForm.querySelector('button'), async () => {
      addErr.hidden = true;
      try {
        const t = await api('POST', `/plans/${plan.id}/tasks`, taskBody(addForm));
        tasks.push(t);
        addForm.reset();
        addForm.querySelector('#new-pri').value = '2';
        toast('할 일을 추가했습니다.');
        draw();
      } catch (e) { showError(addErr, e); }
    });
  });

  // 도구줄
  const search = h('input', { type: 'search', id: 'f-q', placeholder: '제목·태그로 찾기', oninput: (e) => { ui.q = e.target.value; draw(); } });
  const statusSel = h('select', { id: 'f-status', onchange: (e) => { ui.status = e.target.value; draw(); } },
    h('option', { value: '' }, '전체'), h('option', { value: 'in_progress' }, '진행 중'), h('option', { value: 'done' }, '완료'));
  const priSel = h('select', { id: 'f-pri', onchange: (e) => { ui.pri = e.target.value; draw(); } },
    h('option', { value: '' }, '전체'), [1, 2, 3].map((p) => h('option', { value: p }, PRI[p])));
  const tagSel = h('select', { id: 'f-tag', onchange: (e) => { ui.tag = e.target.value; draw(); } });
  const sortSel = h('select', { id: 'f-sort', onchange: (e) => { ui.sort = e.target.value; try { localStorage.setItem('pds-sort', ui.sort); } catch { /* 무시 */ } draw(); } },
    Object.entries(SORTS).map(([k, s]) => h('option', { value: k, selected: k === ui.sort }, s.label)));
  const sortRule = h('p', { class: 'sort-rule', id: 'sort-rule' });
  const count = h('span', { class: 'hint', 'aria-live': 'polite' });
  const focusBox = h('div', {});
  const listBox = h('div', {});

  const toolbar = h('div', { class: 'toolbar' },
    field('검색', search, 'search'), field('상태', statusSel), field('우선순위', priSel), field('태그', tagSel), field('정렬', sortSel));
  const row2 = h('div', { class: 'toolbar-row2' },
    h('div', { class: 'form-actions' },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'f-late', onchange: (e) => { ui.late = e.target.checked; draw(); } }), '지연만'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'f-blocked', onchange: (e) => { ui.blocked = e.target.checked; draw(); } }), '막힘만')),
    count);

  root.replaceChildren(h('div', { class: 'stack' },
    h('section', { class: 'panel' }, h('h2', {}, '할 일 추가'), addForm),
    h('section', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h2', {}, '할 일 목록'), h('span', { class: 'hint' }, `오늘(서울) ${fmtDate(seoulToday())}`)),
      toolbar, row2, sortRule, focusBox, listBox)));

  function draw() {
    const today = seoulToday();
    // 태그 목록 새로 고침
    const allTags = [...new Set(tasks.flatMap((t) => t.tags))].sort((a, b) => a.localeCompare(b, 'ko'));
    if (ui.tag && !allTags.includes(ui.tag)) ui.tag = '';
    tagSel.replaceChildren(h('option', { value: '' }, '전체'), allTags.map((t) => h('option', { value: t, selected: t === ui.tag }, `#${t}`)));

    sortRule.replaceChildren(h('b', {}, '정렬 기준'), SORTS[ui.sort].rule);

    focusBox.replaceChildren(ui.focus
      ? h('div', { class: 'focus-banner' }, h('span', {}, `${ui.focus.label} ${ui.focus.ids.size}건만 보는 중`),
        h('a', { class: 'btn quiet small', href: `#/plan/${plan.id}/tasks` }, '모든 할 일 보기'))
      : '');

    const needle = ui.q.trim().toLowerCase();
    const shown = sortTasks(tasks.filter((t) => {
      if (ui.focus && !ui.focus.ids.has(t.id)) return false;
      if (needle && !(t.title.toLowerCase().includes(needle) || t.tags.some((g) => g.toLowerCase().includes(needle)))) return false;
      if (ui.status && t.status !== ui.status) return false;
      if (ui.pri && String(t.priority) !== ui.pri) return false;
      if (ui.tag && !t.tags.includes(ui.tag)) return false;
      if (ui.late && !(t.status !== 'done' && t.due_date && t.due_date < today)) return false;
      if (ui.blocked && !t.is_blocked) return false;
      return true;
    }), ui.sort);
    count.textContent = `${tasks.length}개 중 ${shown.length}개 표시`;

    listBox.replaceChildren(shown.length
      ? h('ul', { class: 'task-list' }, shown.map((t) => taskItem(t, today)))
      : h('p', { class: 'empty' }, tasks.length ? '조건에 맞는 할 일이 없습니다.' : '아직 할 일이 없습니다. 위에서 추가해 보세요.'));
  }

  function replaceTask(next) {
    tasks = tasks.map((t) => (t.id === next.id ? { ...t, ...next } : t));
    draw();
  }

  function taskItem(t, today) {
    const late = t.status !== 'done' && t.due_date && t.due_date < today;
    const done = t.status === 'done';
    const li = h('li', { class: `task${done ? ' done' : ''}${t.id === flashId ? ' flash' : ''}`, id: `task-${t.id}` });

    const tick = h('button', {
      class: 'tick', type: 'button', 'aria-pressed': done ? 'true' : 'false',
      'aria-label': done ? `"${t.title}" 진행 중으로 되돌리기` : `"${t.title}" 완료하기`,
      title: done ? '진행 중으로 되돌리기' : '완료',
    }, '✓');
    tick.addEventListener('click', () => busy(tick, async () => {
      try {
        const next = await api('POST', `/tasks/${t.id}/${done ? 'reopen' : 'complete'}`);
        if (next.changed) toast(done ? '진행 중으로 되돌렸습니다.' : '완료로 바꿨습니다.');
        replaceTask(next);
      } catch (e) { toast(e.message, true); }
    }));

    const chips = h('div', { class: 'chips' },
      done ? h('span', { class: 'chip ok' }, '완료') : h('span', { class: 'chip' }, '진행 중'),
      t.due_date ? h('span', { class: `chip${late ? ' late' : ''}` }, `${late ? '지연 · ' : ''}마감 ${fmtDate(t.due_date)}`) : h('span', { class: 'chip' }, '마감일 없음'),
      t.priority ? h('span', { class: `chip p${t.priority}` }, `우선순위 ${PRI[t.priority]}`) : null,
      t.tags.map((g) => h('span', { class: 'chip tag' }, `#${g}`)),
      h('span', { class: 'chip num' }, `예상 ${t.estimate_minutes ?? 0}분 · 실제 ${t.actual_minutes}분`),
      t.is_blocked ? h('span', { class: 'chip block' }, '막힘 기록 있음') : null);

    const toggle = (mode) => { ui.open[t.id] = ui.open[t.id] === mode ? null : mode; draw(); };
    const actions = h('div', { class: 'task-actions' },
      h('button', { class: 'btn quiet small', type: 'button', 'aria-expanded': ui.open[t.id] === 'logs' ? 'true' : 'false', onclick: () => toggle('logs') }, `실행 기록 ${t.log_count}`),
      h('button', { class: 'btn quiet small', type: 'button', 'aria-expanded': ui.open[t.id] === 'edit' ? 'true' : 'false', onclick: () => toggle('edit') }, '고치기'),
      h('button', { class: 'btn quiet small', type: 'button', onclick: () => toggle('delete') }, '지우기'));

    li.append(h('div', { class: 'task-row' }, tick, h('div', { class: 'task-main' }, h('div', { class: 'task-title' }, t.title), chips), actions));

    const mode = ui.open[t.id];
    if (mode === 'edit') li.append(h('div', { class: 'task-detail' }, editTaskForm(t)));
    if (mode === 'delete') {
      const yes = h('button', { class: 'btn danger small', type: 'button' }, '지우기');
      yes.addEventListener('click', () => busy(yes, async () => {
        try {
          await api('DELETE', `/tasks/${t.id}`);
          tasks = tasks.filter((x) => x.id !== t.id);
          toast('할 일을 지웠습니다. 돌아보기 집계에서도 빠집니다.');
          draw();
        } catch (e) { toast(e.message, true); }
      }));
      li.append(h('div', { class: 'task-detail' }, h('div', { class: 'confirm' }, '이 할 일을 지울까요?', yes,
        h('button', { class: 'btn quiet small', type: 'button', onclick: () => toggle('delete') }, '그만두기'))));
    }
    if (mode === 'logs') {
      const box = h('div', { class: 'task-detail' }, h('p', { class: 'hint' }, '실행 기록을 불러오는 중…'));
      li.append(box);
      taskLogs(t, box);
    }
    return li;
  }

  function editTaskForm(t) {
    const err = errorLine();
    const form = h('form', { class: 'form-grid', novalidate: true }, taskFormFields(t, `e-${t.id.slice(0, 8)}`),
      h('div', { class: 'form-actions wide' }, h('button', { class: 'btn', type: 'submit' }, '저장'),
        h('button', { class: 'btn quiet', type: 'button', onclick: () => { ui.open[t.id] = null; draw(); } }, '그만두기')), err);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      busy(form.querySelector('button[type=submit]'), async () => {
        try {
          const next = await api('PATCH', `/tasks/${t.id}`, taskBody(form));
          ui.open[t.id] = null;
          toast('할 일을 고쳤습니다.');
          replaceTask(next);
        } catch (e) { showError(err, e); }
      });
    });
    return form;
  }

  async function taskLogs(t, box) {
    let logs;
    try { logs = await api('GET', `/tasks/${t.id}/logs`); } catch (e) { box.replaceChildren(h('p', { class: 'form-error' }, e.message)); return; }
    const err = errorLine();
    const start = h('input', { type: 'datetime-local', name: 'started_at', id: `l-start-${t.id.slice(0, 8)}`, required: true, value: nowLocalSeoul(-60) });
    const end = h('input', { type: 'datetime-local', name: 'ended_at', id: `l-end-${t.id.slice(0, 8)}`, required: true, value: nowLocalSeoul() });
    const actual = h('input', { type: 'number', name: 'actual_minutes', id: `l-min-${t.id.slice(0, 8)}`, min: 0, step: 1, inputmode: 'numeric' });
    const fill = () => {
      if (!start.value || !end.value) return;
      const m = Math.round((new Date(localToInstant(end.value)) - new Date(localToInstant(start.value))) / 60000);
      actual.placeholder = m >= 0 ? `${m} (비우면 자동)` : '';
    };
    start.addEventListener('input', fill); end.addEventListener('input', fill); fill();

    const form = h('form', { class: 'form-grid', novalidate: true },
      field('시작 시각 (서울)', start), field('끝난 시각 (서울)', end), field('실제 걸린 시간 (분)', actual),
      field('막혔던 이유 (없으면 비움)', h('input', { name: 'blocked_reason', id: `l-block-${t.id.slice(0, 8)}`, maxlength: 1000 }), 'wide'),
      field('메모', h('input', { name: 'note', id: `l-note-${t.id.slice(0, 8)}`, maxlength: 1000 }), 'wide'),
      h('div', { class: 'form-actions wide' }, h('button', { class: 'btn', type: 'submit' }, '실행 기록 저장'),
        h('span', { class: 'hint' }, '실행 기록은 따로 저장되어 계획과 할 일의 예상 시간은 바뀌지 않습니다.')), err);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      busy(form.querySelector('button[type=submit]'), async () => {
        err.hidden = true;
        const d = formData(form);
        try {
          if (!d.started_at || !d.ended_at) throw new Error('시작 시각과 끝난 시각을 모두 골라 주세요.');
          await api('POST', `/tasks/${t.id}/logs`, {
            started_at: localToInstant(d.started_at), ended_at: localToInstant(d.ended_at),
            actual_minutes: numOrNull(d.actual_minutes), blocked_reason: d.blocked_reason, note: d.note,
          });
          toast('실행 기록을 저장했습니다.');
          const fresh = await api('GET', `/plans/${plan.id}/tasks`);
          tasks = fresh;
          ui.open[t.id] = 'logs';
          draw();
        } catch (e) { showError(err, e); }
      });
    });
    box.replaceChildren(
      logs.length ? h('ul', { class: 'log-list' }, logs.map((l) => logItem(l))) : h('p', { class: 'hint' }, '아직 실행 기록이 없습니다.'),
      h('h3', {}, '실행 기록 추가'), form);
  }

  draw();
  if (flashId) document.getElementById(`task-${flashId}`)?.scrollIntoView({ block: 'center' });
}

function logItem(l, { withTask = false, planId, flash = false } = {}) {
  return h('li', { class: `log${flash ? ' flash' : ''}`, id: `log-${l.id}` },
    h('div', { class: 'log-top' },
      withTask ? h('a', { class: 'log-task', href: `#/plan/${planId}/tasks?task=${l.task_id}` }, l.task_title) : null,
      h('span', { class: 'log-when num' }, `${fmtTime(l.started_at)} → ${fmtTime(l.ended_at)}`),
      h('span', { class: 'chip num' }, `실제 ${fmtMin(l.actual_minutes)}`)),
    l.blocked_reason ? h('div', { class: 'log-blocked' }, `막힌 이유: ${l.blocked_reason}`) : null,
    l.note ? h('div', { class: 'log-note' }, l.note) : null);
}

// ---------- 실행 기록 탭 ----------
async function logsView(plan, params, root) {
  const logs = await api('GET', `/plans/${plan.id}/logs`);
  const fromReview = params.get('show') === 'logs';
  const total = logs.reduce((s, l) => s + l.actual_minutes, 0);
  root.replaceChildren(h('section', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', {}, '실행 기록'), h('span', { class: 'hint num' }, `${logs.length}건 · 합계 ${fmtMin(total)}`)),
    fromReview ? h('div', { class: 'focus-banner' }, h('span', {}, `돌아보기의 "실제 시간" ${total}분은 아래 ${logs.length}건을 더한 값입니다.`),
      h('a', { class: 'btn quiet small', href: `#/plan/${plan.id}/review` }, '돌아보기로')) : null,
    h('p', { class: 'hint' }, '새 기록은 할 일 탭에서 각 할 일의 "실행 기록" 버튼으로 추가합니다. 최근 시작한 순으로 보입니다.'),
    logs.length ? h('ul', { class: 'log-list' }, logs.map((l) => logItem(l, { withTask: true, planId: plan.id, flash: fromReview })))
      : h('p', { class: 'empty' }, '아직 실행 기록이 없습니다.')));
}

// ---------- 돌아보기 ----------
async function reviewView(plan, root) {
  const r = await api('GET', `/plans/${plan.id}/review`);
  const go = (show, tab = 'tasks') => () => { location.hash = `#/plan/${plan.id}/${tab}?show=${show}`; };
  const metric = (cls, label, value, unit, rule, onclick, goText) => h('button', { class: `metric ${cls}`, type: 'button', onclick },
    h('span', { class: 'label' }, label),
    h('span', { class: 'value' }, value, unit ? h('small', {}, unit) : null),
    h('span', { class: 'rule' }, rule),
    h('span', { class: 'go' }, goText));

  const err = errorLine();
  const form = h('form', { class: 'form-grid', novalidate: true },
    field('다음 계획에 넘길 고칠 점 한 가지', h('textarea', { name: 'improvement', id: 'rv-improve', required: true, maxlength: 1000, placeholder: '예: 할 일마다 예상 시간을 30% 넉넉하게 잡는다' }), 'wide'),
    h('div', { class: 'form-actions wide' }, h('button', { class: 'btn', type: 'submit' }, '돌아보기 저장'),
      h('span', { class: 'hint' }, '지금의 집계 숫자도 함께 저장됩니다.')), err);
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    busy(form.querySelector('button'), async () => {
      try {
        await api('POST', `/plans/${plan.id}/reviews`, { improvement: formData(form).improvement });
        toast('돌아보기를 저장했습니다.');
        await reviewView(plan, root);
      } catch (e) { showError(err, e); }
    });
  });

  root.replaceChildren(h('div', { class: 'stack' },
    h('section', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h2', {}, '돌아보기'), h('span', { class: 'hint' }, `오늘(서울) ${fmtDate(r.today)} 기준 · 숫자를 누르면 그 기록으로 갑니다`)),
      h('div', { class: 'metrics' },
        metric('', '계획', r.planned, '건', '지우지 않은 할 일', go('planned'), '할 일 보기 →'),
        metric('ok', '완료', r.completed, '건', '지금 완료 상태인 할 일', go('completed'), '할 일 보기 →'),
        metric('late', '지연', r.overdue, '건', '미완료 + 마감일이 오늘보다 앞섬', go('overdue'), '할 일 보기 →'),
        metric('block', '막힘', r.blocked, '건', '막힌 이유가 적힌 할 일', go('blocked'), '할 일 보기 →')),
      h('div', { class: 'metrics time' },
        metric('', '예상 시간', r.estimate_minutes, '분', '할 일 예상 시간의 합', go('estimate'), '할 일 보기 →'),
        metric('', '실제 시간', r.actual_minutes, '분', '실행 기록 시간의 합', go('logs', 'logs'), '실행 기록 보기 →'),
        metric(r.diff_minutes > 0 ? 'late' : 'ok', '차이', signed(r.diff_minutes), '분', '실제 − 예상', go('logs', 'logs'), '실행 기록 보기 →'))),
    h('section', { class: 'panel' }, h('h2', {}, '고칠 점 정하기'), form),
    h('section', { class: 'panel' }, h('h2', {}, '저장한 돌아보기'),
      r.saved.length ? h('ul', { class: 'review-list' }, r.saved.map((s) => h('li', { class: 'review-item' },
        h('p', {}, h('span', { class: 'hint num' }, `${fmtTime(s.created_at)} · 완료 ${s.summary.completed}/${s.summary.planned} · 지연 ${s.summary.overdue} · 막힘 ${s.summary.blocked} · 차이 ${signed(s.summary.diff_minutes)}분`), h('br'), s.improvement),
        h('a', { class: 'btn ghost small', href: `#/?carry=${s.id}` }, '이 고칠 점으로 다음 계획 만들기'))))
        : h('p', { class: 'empty' }, '아직 저장한 돌아보기가 없습니다.'))));
}

// ---------- 계획 고치기 · 이전 버전 ----------
function editView(plan, root) {
  const FIELDS = [['title', '이름'], ['start_date', '시작일'], ['end_date', '종료일'], ['priority', '우선순위'], ['estimate_minutes', '예상 시간(분)'], ['success_criteria', '성공 기준']];
  const show = (k, v) => (k === 'priority' ? `${v} · ${PRI[v]}` : String(v));
  // 각 버전을 바로 다음(더 새) 내용과 비교해 바뀐 칸을 표시한다
  const chain = [plan, ...plan.versions];
  root.replaceChildren(h('div', { class: 'stack' },
    h('section', { class: 'panel' }, h('h2', {}, `계획 고치기 (지금 버전 ${plan.version})`),
      planForm({ plan, onSaved: () => route() })),
    h('section', { class: 'panel' }, h('h2', {}, '이전 버전'),
      h('p', { class: 'hint' }, '계획을 고칠 때마다 고치기 전 내용이 plan_versions 표에 한 줄씩 남습니다. 노란 칸은 다음 버전에서 바뀐 값입니다.'),
      plan.versions.length ? h('ul', { class: 'versions' }, plan.versions.map((v, i) => {
        const newer = chain[i];
        return h('li', { class: 'version' },
          h('h3', {}, `버전 ${v.version} · ${fmtTime(v.saved_at)}에 고치기 전 내용`),
          h('dl', {}, FIELDS.map(([k, label]) => [h('dt', {}, label),
            h('dd', {}, h('span', { class: String(v[k]) !== String(newer[k]) ? 'changed' : '' }, show(k, v[k])))])));
      })) : h('p', { class: 'empty' }, '아직 고친 적이 없습니다. 위에서 한 번 고쳐 저장하면 지금 내용이 여기 남습니다.'))));
}
