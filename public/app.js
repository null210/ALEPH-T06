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
  // 로그인이 풀렸으면(로그아웃·만료) 어느 화면에 있든 로그인 화면으로 보낸다
  if (res.status === 401 && !url.startsWith('/auth/')) { setUser(null); throw new NeedLogin(); }
  if (!res.ok) throw new Error(data?.error ?? `요청이 실패했습니다 (${res.status}).`);
  return data;
}
class NeedLogin extends Error { constructor() { super('로그인이 필요합니다.'); } }

// ---------- 로그인 상태 ----------
let me; // undefined = 아직 모름, null = 로그인 안 함
const nav = document.getElementById('top-nav');
function setUser(user) {
  me = user;
  nav.hidden = !user;
  document.getElementById('who').textContent = user ? user.email : '';
}
document.getElementById('logout').addEventListener('click', async (ev) => {
  await busy(ev.currentTarget, async () => {
    try { await api('POST', '/auth/logout'); } catch { /* 이미 풀렸어도 로그인 화면으로 */ }
    setUser(null);
    toast('로그아웃했습니다.');
    location.hash = '#/';
    route();
  });
});

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
    if (me === undefined) {
      try { setUser((await api('GET', '/auth/me')).user); } catch { setUser(null); }
    }
    // 로그인 전에는 어떤 주소(#/plan/... 포함)로 와도 로그인 화면만 보인다
    if (!me) return renderAuth(parts[0] === 'signup' ? 'signup' : 'login');
    if (parts[0] === 'plan' && parts[1]) await renderPlan(parts[1], parts[2] ?? 'tasks', params);
    else if (parts[0] === 'diary') await renderDiary();
    else if (parts[0] === 'account') renderAccount();
    else await renderHome(params);
  } catch (e) {
    if (e instanceof NeedLogin) return renderAuth('login');
    app.replaceChildren(h('div', { class: 'panel' },
      h('h1', {}, '화면을 열 수 없습니다'), h('p', {}, e.message), h('p', {}, h('a', { href: '#/' }, '계획 목록으로 가기'))));
  }
}
window.addEventListener('hashchange', route);
route();

// ---------- 로그인·가입 화면 ----------
function renderAuth(mode) {
  document.title = mode === 'signup' ? '가입 · PDS 플래너' : '로그인 · PDS 플래너';
  const signup = mode === 'signup';
  const err = errorLine();
  const form = h('form', { class: 'form-grid', novalidate: true },
    field('이메일', h('input', { type: 'email', name: 'email', id: 'auth-email', required: true, autocomplete: 'username', maxlength: 254 }), 'wide'),
    field(signup ? '비밀번호 (8자 이상)' : '비밀번호',
      h('input', { type: 'password', name: 'password', id: 'auth-password', required: true, minlength: signup ? 8 : null, maxlength: 200, autocomplete: signup ? 'new-password' : 'current-password' }), 'wide'),
    signup ? field('비밀번호 한 번 더', h('input', { type: 'password', name: 'password2', id: 'auth-password2', required: true, autocomplete: 'new-password' }), 'wide') : null,
    h('div', { class: 'form-actions wide' }, h('button', { class: 'btn', type: 'submit', id: 'auth-submit' }, signup ? '가입하고 시작하기' : '로그인')),
    err);
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    busy(form.querySelector('button[type=submit]'), async () => {
      err.hidden = true;
      // 비밀번호는 trim 하지 않는다 (앞뒤 공백도 비밀번호의 일부)
      const fd = new FormData(form);
      const body = { email: String(fd.get('email')).trim(), password: String(fd.get('password')) };
      try {
        if (signup && body.password !== String(fd.get('password2'))) throw new Error('두 비밀번호가 같지 않습니다.');
        const out = await api('POST', signup ? '/auth/signup' : '/auth/login', body);
        setUser(out.user);
        toast(signup ? '가입했습니다. 이제 내 계획을 세워 보세요.' : '로그인했습니다.');
        if (location.hash.startsWith('#/signup') || !location.hash) location.hash = '#/';
        route();
      } catch (e) { showError(err, e); }
    });
  });
  app.replaceChildren(h('section', { class: 'panel auth' },
    h('h1', {}, signup ? '가입' : '로그인'),
    h('p', { class: 'hint' }, '로그인해야 내 계획·할 일·실행 기록이 보입니다. 다른 사람의 자료는 보이지 않습니다.'),
    h('nav', { class: 'auth-switch', 'aria-label': '로그인 또는 가입' },
      h('a', { href: '#/login', 'aria-current': signup ? null : 'page' }, '로그인'), ' · ',
      h('a', { href: '#/signup', 'aria-current': signup ? 'page' : null }, '처음이면 가입')),
    form));
  form.querySelector('#auth-email').focus();
}

// ---------- 첫 화면: 계획 목록 + 새 계획 ----------
async function renderHome(params) {
  const [plans, reviews, diary] = await Promise.all([api('GET', '/plans'), api('GET', '/reviews'), api('GET', '/diary')]);
  document.title = 'PDS 플래너';
  const todayBox = h('a', { class: 'today-banner', href: '#/diary' },
    h('b', {}, `오늘(서울) ${fmtDate(diary.today)}`),
    !diary.experiment ? '5일 기록을 아직 시작하지 않았습니다. 질문·지표부터 정하기 →'
      : diary.today_entry ? `오늘 ${diary.today_entry.day_no}일차 기록을 남겼습니다. 고치려면 누르세요 →`
        : diary.entries.length >= 5 ? '5일 기록을 모두 마쳤습니다. 결과 보기 →'
          : `오늘 ${diary.entries.length + 1}일차 기록을 아직 남기지 않았습니다 →`);

  const list = plans.length
    ? h('ul', { class: 'plan-list' }, plans.map((p) => h('li', {},
      h('a', { class: 'plan-link', href: `#/plan/${p.id}` },
        h('span', { class: 't' }, p.title),
        h('span', { class: 'meta' }, `${p.start_date} ~ ${p.end_date} · 우선순위 ${PRI[p.priority]} · 예상 ${fmtMin(p.estimate_minutes)}`),
        h('span', { class: 'prog' }, h('b', { class: 'num' }, `${p.done_count}/${p.task_count}`), '완료')))))
    : h('p', { class: 'empty' }, '아직 계획이 없습니다. 오른쪽에서 첫 계획을 세워 보세요.');

  app.replaceChildren(
    todayBox,
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

// ---------- 5일 기록 (로그인 → 오늘 기록) ----------
const fmtVal = (v, unit) => (v == null ? '빠짐' : `${v}${unit ? ` ${unit}` : ''}`);
const RULE_LABEL = { missing: '값이 빠졌을 때', duplicate: '같은 날 두 번 저장할 때', outlier: '값이 튈 때', rounding: '반올림', week_start: '주 시작 요일', date: '날짜', compare: '전후 비교' };

async function renderDiary() {
  const d = await api('GET', '/diary');
  document.title = '오늘 기록 · PDS 플래너';
  const rulesBox = h('section', { class: 'panel' }, h('h2', {}, '기록 처리 규칙 (앱이 이 문장대로 계산합니다)'),
    h('dl', { class: 'rules' }, Object.entries(d.rules).map(([k, v]) => [h('dt', {}, RULE_LABEL[k] ?? k), h('dd', {}, v)])));

  if (!d.experiment) {
    const err = errorLine();
    const form = h('form', { class: 'form-grid', novalidate: true },
      field('1일차에 답하려는 질문 (한 문장)', h('input', { name: 'question', id: 'ex-question', required: true, maxlength: 300, placeholder: '예: 할 일 예상 시간을 넉넉히 잡으면 실제와의 차이가 줄어드는가?' }), 'wide'),
      field('관찰 지표 (하나)', h('input', { name: 'metric', id: 'ex-metric', required: true, maxlength: 100, placeholder: '예: 하루 예상 대비 실제 시간 차이' })),
      field('단위', h('input', { name: 'unit', id: 'ex-unit', required: true, maxlength: 20, placeholder: '예: 분' })),
      field('계산 규칙 (사람이 읽는 문장)', h('textarea', { name: 'calc_rule', id: 'ex-calc', required: true, maxlength: 500, placeholder: '예: 그날 마감인 할 일들의 (실제 시간 합 − 예상 시간 합). 실제가 길면 +' }), 'wide'),
      field('처음 계획 규칙 (1·2일차)', h('input', { name: 'plan_rule', id: 'ex-rule', required: true, maxlength: 300, placeholder: '예: 할 일 예상 시간은 떠오르는 대로 적는다' }), 'wide'),
      h('div', { class: 'form-actions wide' }, h('button', { class: 'btn', type: 'submit' }, '이대로 정하기'),
        h('span', { class: 'hint' }, '한 번 정하면 5일 동안 바꿀 수 없습니다. 계획 규칙은 2일차 뒤에 딱 한 번 바꿉니다.')), err);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      busy(form.querySelector('button'), async () => {
        try { await api('POST', '/diary/setup', formData(form)); toast('정했습니다. 이제 오늘 기록을 남기세요.'); await renderDiary(); } catch (e) { showError(err, e); }
      });
    });
    app.replaceChildren(h('section', { class: 'panel' }, h('h1', {}, '5일 기록 시작하기'),
      h('p', { class: 'hint' }, `오늘(서울) ${fmtDate(d.today)}. 기록은 로그인한 내 계정에만 저장되고, 날짜는 서버가 정한 오늘로만 들어갑니다.`), form), rulesBox);
    return;
  }

  const ex = d.experiment;
  const n = d.entries.length;
  const head = h('section', { class: 'plan-head' },
    h('h1', {}, '5일 기록'),
    h('dl', { class: 'facts' },
      h('div', { class: 'span' }, h('dt', {}, '질문'), h('dd', {}, ex.question)),
      h('div', {}, h('dt', {}, '지표'), h('dd', {}, ex.metric)),
      h('div', {}, h('dt', {}, '단위'), h('dd', {}, ex.unit)),
      h('div', {}, h('dt', {}, '정한 시각'), h('dd', { class: 'num' }, fmtTime(ex.created_at))),
      h('div', { class: 'span' }, h('dt', {}, '계산 규칙'), h('dd', {}, ex.calc_rule)),
      h('div', { class: 'span' }, h('dt', {}, '지금 계획 규칙'), h('dd', {}, d.current_rule, h('span', { class: 'hint' }, d.rule_change ? ' (3일차부터)' : ' (1·2일차)')))));

  // 오늘 기록 / 규칙 바꾸기
  let action;
  const needChange = n === 2 && !d.rule_change && !d.today_entry;
  if (d.today_entry || (n < 5 && !needChange)) {
    const t = d.today_entry;
    const err = errorLine();
    const form = h('form', { class: 'form-grid', novalidate: true },
      field(`${ex.metric} (${ex.unit}) — 비우면 "빠짐"`, h('input', { type: 'number', step: 'any', name: 'value', id: 'day-value', inputmode: 'decimal', value: t?.value ?? '' })),
      field('메모', h('input', { name: 'note', id: 'day-note', maxlength: 1000, value: t?.note ?? '' }), 'wide'),
      h('div', { class: 'form-actions wide' }, h('button', { class: 'btn', type: 'submit' }, t ? '오늘 기록 고치기' : `${n + 1}일차 기록 저장`),
        h('span', { class: 'hint' }, t ? `이미 ${t.day_no}일차로 저장했습니다(${fmtTime(t.updated_at)}). 다시 저장하면 오늘 값만 바뀝니다.` : '오늘 날짜로만 저장됩니다.')), err);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      busy(form.querySelector('button'), async () => {
        const f = formData(form);
        try {
          const r = await api('PUT', '/diary/today', { value: f.value === '' ? null : Number(f.value), note: f.note });
          toast(r.replaced ? '오늘 값을 바꿨습니다.' : `${r.day_no}일차를 저장했습니다.`);
          await renderDiary();
        } catch (e) { showError(err, e); }
      });
    });
    action = h('section', { class: 'panel' }, h('h2', {}, `오늘(서울) ${fmtDate(d.today)} 기록`), form);
  } else if (needChange) {
    const err = errorLine();
    const form = h('form', { class: 'form-grid', novalidate: true },
      field('바꾸기 전 규칙', h('input', { value: ex.plan_rule, disabled: true }), 'wide'),
      field('바꾼 규칙 (하나만)', h('input', { name: 'after_rule', id: 'rc-after', required: true, maxlength: 300 }), 'wide'),
      field('바꾼 이유 (1·2일차 숫자를 근거로)', h('textarea', { name: 'reason', id: 'rc-reason', required: true, maxlength: 1000 }), 'wide'),
      h('div', { class: 'form-actions wide' }, h('button', { class: 'btn', type: 'submit' }, '규칙 바꾸기 (한 번만)')), err);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      busy(form.querySelector('button'), async () => {
        try { await api('POST', '/diary/rule-change', formData(form)); toast('규칙을 바꿨습니다. 이제 3일차를 기록할 수 있습니다.'); await renderDiary(); } catch (e) { showError(err, e); }
      });
    });
    action = h('section', { class: 'panel' }, h('h2', {}, '3일차 전에 계획 규칙 하나 바꾸기'),
      h('p', { class: 'hint' }, '1·2일차 기록을 마쳤습니다. 3일차를 적기 전에 규칙을 딱 하나 바꿔야 합니다. 바꾼 시각이 함께 저장됩니다.'), form);
  } else {
    action = h('section', { class: 'panel' }, h('h2', {}, '5일 기록을 모두 마쳤습니다'), h('p', { class: 'hint' }, '아래 비교와 내보내기 파일을 제출물에 쓰세요.'));
  }

  // 기록 순서: 1일차, 2일차, [규칙 변경], 3~5일차
  const row = (e) => h('tr', { class: e.outlier ? 'outlier' : '' },
    h('td', {}, `${e.day_no}일차`), h('td', { class: 'num' }, fmtDate(e.entry_date)), h('td', { class: 'num' }, `${e.week_monday}(월) 주`),
    h('td', { class: 'num' }, fmtVal(e.value, ex.unit), e.outlier ? h('span', { class: 'chip late' }, '튐') : null),
    h('td', {}, e.phase === 'before' ? '바꾸기 전' : '바꾼 뒤'),
    h('td', { class: 'num' }, fmtTime(e.created_at), e.updated_at !== e.created_at ? ` (고침 ${fmtTime(e.updated_at)})` : ''),
    h('td', {}, e.note ?? ''));
  const rows = [];
  for (const e of d.entries) {
    rows.push(row(e));
    if (e.day_no === 2 && d.rule_change) {
      const rc = d.rule_change;
      rows.push(h('tr', { class: 'rule-row' }, h('td', { colspan: 7 },
        h('b', {}, `🔁 계획 규칙 변경 · ${fmtTime(rc.changed_at)}`), h('br'),
        `"${rc.before_rule}" → "${rc.after_rule}"`, h('br'), `이유: ${rc.reason}`, h('br'),
        h('span', { class: 'hint' }, `1일차(${d.entries[0].entry_date})·2일차(${d.entries[1].entry_date}) 기록 뒤, 3일차 앞`))));
    }
  }
  const table = d.entries.length
    ? h('div', { class: 'table-wrap' }, h('table', { class: 'diary' },
      h('thead', {}, h('tr', {}, ['일차', '날짜', '주', '값', '단계', '저장 시각', '메모'].map((x) => h('th', {}, x)))), h('tbody', {}, rows)))
    : h('p', { class: 'empty' }, '아직 기록이 없습니다.');

  // 화면 합계·평균과 손으로 더한 식
  const s = d.summary;
  const calc = (p, label) => {
    const nums = p.values.map((v) => (v == null ? '빠짐' : v));
    return h('div', { class: 'calc' }, h('h3', {}, label),
      p.days ? [
        h('p', {}, `기록한 날 ${p.days}일 · 값 있는 날 ${p.filled}일 · 빠진 날 ${p.missing}일`),
        h('p', { class: 'num' }, `합계 = ${nums.join(' + ')} = ${p.sum ?? '없음'}${p.sum != null ? ` ${ex.unit}` : ''}`),
        h('p', { class: 'num' }, `평균 = ${p.sum ?? '없음'} ÷ ${p.filled} = ${p.average ?? '없음'}${p.average != null ? ` ${ex.unit}` : ''}`),
      ] : h('p', { class: 'hint' }, '아직 기록 없음'));
  };
  const compare = h('section', { class: 'panel' }, h('h2', {}, '규칙 바꾸기 전후 비교 (같은 지표·단위·계산 규칙)'),
    h('div', { class: 'calc-grid' }, calc(s.before, '바꾸기 전 (1·2일차)'), calc(s.after, '바꾼 뒤 (3~5일차)')),
    h('p', {}, h('b', {}, '평균 차이(뒤 − 전): '), s.diff_average == null ? '아직 비교할 수 없음' : `${signed(s.diff_average)} ${ex.unit}`));

  app.replaceChildren(head, action, h('section', { class: 'panel' }, h('h2', {}, `기록 (${n}/5일)`), table), compare, rulesBox);
}

// ---------- 계정: 비밀번호 바꾸기 · 계정 지우기 ----------
function renderAccount() {
  document.title = '계정 · PDS 플래너';
  const pwErr = errorLine();
  const pwForm = h('form', { class: 'form-grid', novalidate: true },
    field('지금 비밀번호', h('input', { type: 'password', name: 'current_password', id: 'pw-current', required: true, autocomplete: 'current-password' }), 'wide'),
    field('새 비밀번호 (8자 이상)', h('input', { type: 'password', name: 'new_password', id: 'pw-new', required: true, minlength: 8, autocomplete: 'new-password' }), 'wide'),
    h('div', { class: 'form-actions wide' }, h('button', { class: 'btn', type: 'submit' }, '비밀번호 바꾸기'),
      h('span', { class: 'hint' }, '바꾸면 다른 기기와 예전 로그인은 모두 끊기고, 이 기기만 새로 로그인된 상태로 남습니다.')), pwErr);
  pwForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    busy(pwForm.querySelector('button'), async () => {
      const fd = new FormData(pwForm);
      try {
        await api('POST', '/auth/password', { current_password: String(fd.get('current_password')), new_password: String(fd.get('new_password')) });
        pwForm.reset();
        toast('비밀번호를 바꿨습니다. 다른 기기의 로그인은 끊겼습니다.');
      } catch (e) { showError(pwErr, e); }
    });
  });

  const delErr = errorLine();
  const delForm = h('form', { class: 'form-grid', novalidate: true },
    field('비밀번호를 다시 적어 확인', h('input', { type: 'password', name: 'password', id: 'del-password', required: true, autocomplete: 'current-password' }), 'wide'),
    h('label', { class: 'check wide' }, h('input', { type: 'checkbox', name: 'sure', id: 'del-sure' }), '모든 자료가 지워지고 되돌릴 수 없다는 것을 알았습니다'),
    h('div', { class: 'form-actions wide' }, h('button', { class: 'btn danger', type: 'submit' }, '계정과 내 자료 모두 지우기')), delErr);
  delForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    busy(delForm.querySelector('button'), async () => {
      const fd = new FormData(delForm);
      try {
        if (!fd.get('sure')) throw new Error('지워진다는 것을 확인하는 칸에 표시해 주세요.');
        await api('DELETE', '/auth/account', { password: String(fd.get('password')) });
        setUser(null);
        toast('계정과 모든 자료를 지웠습니다.');
        location.hash = '#/';
        route();
      } catch (e) { showError(delErr, e); }
    });
  });

  app.replaceChildren(
    h('section', { class: 'panel' }, h('h1', {}, '계정'), h('p', {}, `로그인한 이메일: ${me.email}`),
      h('p', {}, h('a', { class: 'btn ghost small', href: '/api/export', download: true }, '내 자료 전체를 파일 하나로 내보내기'))),
    h('section', { class: 'panel' }, h('h2', {}, '비밀번호 바꾸기'), pwForm),
    h('section', { class: 'panel danger-zone' }, h('h2', {}, '계정 지우기'),
      h('p', { class: 'warn', id: 'delete-notice' }, '계정을 지우면 계획·할 일·실행 기록·돌아보기·5일 기록이 모두 함께 지워지고 되돌릴 수 없습니다. 먼저 위에서 내 자료를 내보내 두세요.'),
      delForm));
}
