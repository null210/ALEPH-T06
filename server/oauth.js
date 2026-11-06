// GitHub · Google 로 가입·로그인 (OAuth 2.0 인가 코드 방식, 라이브러리 없이 직접 구현).
//
// 흐름: [버튼] GET /api/auth/oauth/:provider/start
//        → state(무작위 32바이트)와 Google 은 PKCE code_verifier 를 짧은 HttpOnly 쿠키에 두고 제공자 로그인 화면으로 보냄
//        → 제공자가 GET /api/auth/oauth/:provider/callback?code&state 로 돌려보냄
//        → 쿠키의 state 와 같은지 확인 (다르면 거절: 남이 만든 로그인 링크로 내 브라우저를 그 사람 계정에 붙이는 공격 방지)
//        → code 를 서버끼리 access token 으로 바꾸고(client secret 은 서버 환경 변수에만), 제공자가 "인증했다"는 이메일을 받음
//        → 기존 서버 세션(auth.js 의 startSession)을 주고 화면(/#/)으로 보냄
//
// 계정 고르기: ① 이 제공자 계정으로 전에 들어온 적 있으면 그 사람
//              ② 아니면 같은 이메일로 가입한 사람이 있으면 그 계정에 연결 (제공자가 인증한 이메일일 때만)
//              ③ 둘 다 아니면 비밀번호 없는 새 계정을 만든다
// client ID·secret 환경 변수가 없는 제공자는 꺼진다(버튼이 안 보이고 start 는 404).
import { randomBytes, createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { parseCookies } from './auth.js';

const STATE_COOKIE = 'pds_oauth';
const STATE_MAX_AGE = 600; // 10분 안에 돌아와야 한다

export const PROVIDERS = {
  github: {
    label: 'GitHub',
    env: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'],
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
    pkce: false,
    async profile(token, f) {
      const h = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'pds-planner' };
      const u = await (await f('https://api.github.com/user', { headers: h })).json();
      const emails = await (await f('https://api.github.com/user/emails', { headers: h })).json();
      const primary = Array.isArray(emails) ? emails.find((e) => e.primary && e.verified) : null;
      return { id: u?.id != null ? String(u.id) : null, email: primary?.email ?? null, verified: !!primary };
    },
  },
  google: {
    label: 'Google',
    env: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email',
    pkce: true,
    async profile(token, f) {
      const u = await (await f('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${token}` } })).json();
      return { id: u?.sub ?? null, email: u?.email ?? null, verified: u?.email_verified === true };
    },
  },
};

const creds = (p) => {
  const [id, secret] = PROVIDERS[p].env.map((k) => process.env[k]?.trim());
  return id && secret ? { id, secret } : null;
};
export const enabledProviders = () => Object.keys(PROVIDERS).filter((p) => creds(p));

// 제공자에 등록한 주소와 똑같아야 한다. PUBLIC_URL 이 있으면 그것을, 없으면 요청이 들어온 주소를 쓴다.
function redirectUri(req, provider) {
  const base = process.env.PUBLIC_URL?.trim().replace(/\/$/, '') || `${req.protocol}://${req.get('host')}`;
  return `${base}/api/auth/oauth/${provider}/callback`;
}
const b64url = (buf) => Buffer.from(buf).toString('base64url');
function stateCookie(req, value, maxAge) {
  const secure = req.secure ? '; Secure' : '';
  return `${STATE_COOKIE}=${value}; Path=/api/auth/oauth; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// 실패하면 로그인 화면으로 돌려보내며 이유 코드만 붙인다 (토큰·코드는 주소에 싣지 않는다)
const fail = (res, req, code) => {
  res.append('Set-Cookie', stateCookie(req, '', 0));
  return res.redirect(302, `/#/login?error=${code}`);
};

export function oauthRoutes(router, { q, startSession, claimOrphans, fetchImpl }) {
  router.get('/auth/providers', (req, res) => {
    res.json({ providers: enabledProviders().map((p) => ({ id: p, label: PROVIDERS[p].label })) });
  });

  router.get('/auth/oauth/:provider/start', (req, res) => {
    const p = req.params.provider;
    const c = PROVIDERS[p] && creds(p);
    if (!c) return res.status(404).json({ error: '이 로그인 방법은 켜져 있지 않습니다.' });
    const state = b64url(randomBytes(32));
    const verifier = PROVIDERS[p].pkce ? b64url(randomBytes(32)) : '';
    const url = new URL(PROVIDERS[p].authorizeUrl);
    url.searchParams.set('client_id', c.id);
    url.searchParams.set('redirect_uri', redirectUri(req, p));
    url.searchParams.set('scope', PROVIDERS[p].scope);
    url.searchParams.set('state', state);
    if (PROVIDERS[p].pkce) {
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('code_challenge', b64url(createHash('sha256').update(verifier).digest()));
      url.searchParams.set('code_challenge_method', 'S256');
    }
    res.set('Set-Cookie', stateCookie(req, `${p}.${state}.${verifier}`, STATE_MAX_AGE));
    res.set('Cache-Control', 'no-store');
    res.redirect(302, url.toString());
  });

  router.get('/auth/oauth/:provider/callback', async (req, res) => {
    const p = req.params.provider;
    const c = PROVIDERS[p] && creds(p);
    if (!c) return res.status(404).json({ error: '이 로그인 방법은 켜져 있지 않습니다.' });
    if (req.query.error) return fail(res, req, 'denied'); // 사용자가 제공자 화면에서 취소
    const [cp, cState, verifier] = String(parseCookies(req.headers.cookie)[STATE_COOKIE] ?? '').split('.');
    if (cp !== p || !same(cState, String(req.query.state ?? ''))) return fail(res, req, 'state');
    const code = String(req.query.code ?? '');
    if (!code) return fail(res, req, 'state');

    let profile;
    try {
      const body = new URLSearchParams({
        client_id: c.id, client_secret: c.secret, code, redirect_uri: redirectUri(req, p),
        ...(PROVIDERS[p].pkce ? { grant_type: 'authorization_code', code_verifier: verifier } : {}),
      });
      const tr = await fetchImpl(PROVIDERS[p].tokenUrl, {
        method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body,
      });
      const tok = await tr.json();
      if (!tok?.access_token) return fail(res, req, 'token');
      profile = await PROVIDERS[p].profile(tok.access_token, fetchImpl);
    } catch (e) {
      console.error('[oauth]', p, e.code ?? '', String(e.message ?? '').split('\n')[0]); // 토큰·코드는 찍지 않는다
      return fail(res, req, 'provider');
    }
    if (!profile.id) return fail(res, req, 'provider');
    if (!profile.email || !profile.verified) return fail(res, req, 'email');
    const emailLc = profile.email.trim().toLowerCase();

    // ① 전에 이 제공자 계정으로 들어온 사람
    let [user] = await q(
      `SELECT u.id, u.email FROM oauth_accounts o JOIN users u ON u.id = o.user_id
        WHERE o.provider = $1 AND o.provider_user_id = $2`, [p, profile.id]);
    if (!user) {
      // ② 같은 (인증된) 이메일의 기존 계정에 연결, ③ 없으면 비밀번호 없는 새 계정
      [user] = await q('SELECT id, email FROM users WHERE email = $1', [emailLc]);
      if (!user) {
        const id = randomUUID();
        const rows = await q(
          `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, NULL)
           ON CONFLICT (email) DO NOTHING RETURNING id, email`, [id, emailLc]);
        user = rows[0] ?? (await q('SELECT id, email FROM users WHERE email = $1', [emailLc]))[0];
        if (rows[0]) await claimOrphans(user.id, user.email);
      }
      await q(
        `INSERT INTO oauth_accounts (provider, provider_user_id, user_id, email) VALUES ($1, $2, $3, $4)
         ON CONFLICT (provider, provider_user_id) DO NOTHING`, [p, profile.id, user.id, emailLc]);
    }
    await startSession(req, res, user);
    res.append('Set-Cookie', stateCookie(req, '', 0));
    res.redirect(302, '/#/');
  });
}
