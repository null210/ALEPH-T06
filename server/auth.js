// 가입·로그인·로그아웃과 "로그인한 사람만 통과" 검사.
//
// 고른 방식: 서버 세션 + HttpOnly 쿠키 (외부 서비스·추가 패키지 없음)
// - 비밀번호는 원문을 저장하지 않는다. node:crypto 의 scrypt(소금 16바이트, N=32768)로 만든 값만 저장한다.
// - 로그인하면 추측할 수 없는 무작위 토큰(32바이트)을 만들어 쿠키로 주고, DB 에는 그 토큰의 SHA-256 값만 둔다.
//   DB 가 새어도 쿠키 값을 알 수 없고, 로그아웃하면 DB 행을 지우므로 같은 쿠키를 다시 보내도 거절된다.
// - 남의 자료는 "있지만 못 본다(403)"가 아니라 "없다(404)"로 답해, 남의 ID 가 있는지도 알려 주지 않는다.
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);

export const COOKIE = 'pds_sid';
export const SESSION_DAYS = 7;
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 32;
// 같은 이메일로 15분 안에 10번 틀리면 15분 동안 로그인을 막는다
export const MAX_FAILS = 10;
const FAIL_WINDOW_MIN = 15;

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

// ---------- 비밀번호 ----------
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function verifyPassword(password, stored) {
  const [alg, N, r, p, saltB64, keyB64] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const want = Buffer.from(keyB64, 'base64');
  const got = await scrypt(password, Buffer.from(saltB64, 'base64'), want.length,
    { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return got.length === want.length && timingSafeEqual(got, want);
}
// 없는 이메일로 로그인할 때도 같은 만큼 시간을 쓰게 해서, 응답 시간으로 가입 여부를 알기 어렵게 한다
let dummyHash;
async function burnTime(password) {
  dummyHash ??= await hashPassword('dummy-password-for-timing');
  await verifyPassword(password, dummyHash);
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieHeader(req, value, maxAgeSec) {
  const secure = req.secure ? '; Secure' : '';
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

// ---------- 입력 검사 ----------
function email(v) {
  if (typeof v !== 'string') throw new HttpError(400, '이메일을 적어 주세요.');
  const s = v.trim().toLowerCase();
  if (s.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new HttpError(400, '이메일 형식이 올바르지 않습니다.');
  return s;
}
function password(v) {
  if (typeof v !== 'string' || v.length < 8) throw new HttpError(400, '비밀번호는 8자 이상이어야 합니다.');
  if (v.length > 200) throw new HttpError(400, '비밀번호는 200자까지 쓸 수 있습니다.');
  return v;
}

// ---------- 라우터와 검사기 ----------
export function authRoutes(db, router) {
  const q = db.query;

  async function startSession(req, res, user) {
    const token = randomBytes(32).toString('base64url');
    await q(
      `INSERT INTO sessions (token_hash, user_id, expires_at)
       VALUES ($1, $2, now() + make_interval(days => $3))`, [sha256(token), user.id, SESSION_DAYS]);
    await q('DELETE FROM sessions WHERE expires_at < now()'); // 만료된 세션 정리
    res.set('Set-Cookie', cookieHeader(req, token, SESSION_DAYS * 86400));
  }

  router.post('/auth/signup', async (req, res) => {
    const e = email(req.body?.email);
    const pw = password(req.body?.password);
    const id = randomUUID();
    const hash = await hashPassword(pw);
    const rows = await q(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO NOTHING RETURNING id, email, created_at`, [id, e, hash]);
    if (!rows[0]) throw new HttpError(409, '이미 가입된 이메일입니다. 로그인해 주세요.');
    // 6번 과제 때(로그인 없던 때) 넣어 둔 자료는 주인이 없다. OWNER_EMAIL 로 가입한 사람이 한 번만 가져간다.
    const owner = process.env.OWNER_EMAIL?.trim().toLowerCase();
    if (owner && owner === e) await q('UPDATE plans SET user_id = $1 WHERE user_id IS NULL', [id]);
    await startSession(req, res, rows[0]);
    res.status(201).json({ user: { id: rows[0].id, email: rows[0].email } });
  });

  router.post('/auth/login', async (req, res) => {
    const e = email(req.body?.email);
    const pw = typeof req.body?.password === 'string' ? req.body.password : '';
    const [{ n }] = await q(
      `SELECT count(*)::int AS n FROM login_failures
        WHERE email = $1 AND at > now() - make_interval(mins => $2)`, [e, FAIL_WINDOW_MIN]);
    if (n >= MAX_FAILS) throw new HttpError(429, `로그인을 너무 많이 틀렸습니다. ${FAIL_WINDOW_MIN}분 뒤에 다시 해 주세요.`);

    const [user] = await q('SELECT id, email, password_hash FROM users WHERE email = $1', [e]);
    const good = user ? await verifyPassword(pw, user.password_hash) : (await burnTime(pw), false);
    if (!good) {
      await q('INSERT INTO login_failures (id, email) VALUES ($1, $2)', [randomUUID(), e]);
      // 이메일이 없는지, 비밀번호가 틀렸는지 구별해 알려 주지 않는다
      throw new HttpError(401, '이메일 또는 비밀번호가 맞지 않습니다.');
    }
    await q('DELETE FROM login_failures WHERE email = $1', [e]);
    await startSession(req, res, user);
    res.json({ user: { id: user.id, email: user.email } });
  });

  router.post('/auth/logout', async (req, res) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) await q('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
    res.set('Set-Cookie', cookieHeader(req, '', 0));
    res.status(204).end();
  });

  // 여기서부터 아래에 붙는 /api 주소는 모두 로그인해야 열린다
  async function requireUser(req, res, next) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return next(new HttpError(401, '로그인이 필요합니다.'));
    const [row] = await q(
      `SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now()`, [sha256(token)]);
    if (!row) {
      res.set('Set-Cookie', cookieHeader(req, '', 0));
      return next(new HttpError(401, '로그인이 필요합니다. (로그아웃했거나 기간이 지났습니다)'));
    }
    req.user = row;
    next();
  }

  router.get('/auth/me', requireUser, (req, res) => res.json({ user: req.user }));

  async function checkCurrentPassword(userId, pw) {
    const [u] = await q('SELECT password_hash FROM users WHERE id = $1', [userId]);
    if (!u || typeof pw !== 'string' || !(await verifyPassword(pw, u.password_hash))) {
      throw new HttpError(400, '지금 비밀번호가 맞지 않습니다.');
    }
  }

  // 비밀번호 바꾸기: 이 사람의 세션을 모두 지운다(다른 기기·예전 쿠키 모두 끊김). 지금 기기에는 새 세션을 준다.
  router.post('/auth/password', requireUser, async (req, res) => {
    await checkCurrentPassword(req.user.id, req.body?.current_password);
    const next = password(req.body?.new_password);
    await q('UPDATE users SET password_hash = $2 WHERE id = $1', [req.user.id, await hashPassword(next)]);
    await q('DELETE FROM sessions WHERE user_id = $1', [req.user.id]);
    await startSession(req, res, req.user);
    res.json({ user: req.user });
  });

  // 계정 지우기: users 행을 지우면 ON DELETE CASCADE 로 계획·할 일·실행 기록·돌아보기·5일 기록·세션이 함께 지워진다.
  router.delete('/auth/account', requireUser, async (req, res) => {
    await checkCurrentPassword(req.user.id, req.body?.password);
    await q('DELETE FROM users WHERE id = $1', [req.user.id]);
    res.set('Set-Cookie', cookieHeader(req, '', 0));
    res.status(204).end();
  });

  return requireUser;
}

// 다른 사이트가 내 브라우저를 시켜 몰래 요청을 보내는 것(CSRF)을 막는다.
// SameSite=Lax 쿠키가 1차로 막고, 바꾸는 요청은 Origin 이 이 사이트일 때만 받는다.
export function sameOriginOnly(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    let host;
    try { host = new URL(origin).host; } catch { host = null; }
    if (host !== req.headers.host) return next(new HttpError(403, '다른 사이트에서 보낸 요청은 받지 않습니다.'));
  }
  next();
}
