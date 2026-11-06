// 데이터베이스 연결.
// - 배포: PostgreSQL 접속 주소가 환경 변수에 있으면 그 서버에 연결한다.
//   Vercel 에 Supabase 를 연결하면 POSTGRES_URL 이 자동으로 들어온다. DATABASE_URL 을 직접 넣어도 된다.
// - 로컬/테스트: 없으면 PGlite(같은 PostgreSQL 엔진을 파일로 돌리는 것)를 쓴다.
// 접속 주소(비밀값)는 서버 환경 변수에만 있고, 브라우저나 응답·로그로 나가지 않는다.
import { SCHEMA_SQL } from './schema.js';

// 날짜(date)는 'YYYY-MM-DD' 문자열 그대로 둔다. Date 로 바꾸면 시간대 때문에 하루가 밀릴 수 있다.
const asDate = (v) => v;
// 시각(timestamptz)은 ISO 8601 UTC 문자열로 통일한다.
export function toIso(v) {
  if (v == null) return v;
  const s = String(v).replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00');
  return new Date(s).toISOString();
}
const DATE_OID = 1082;
const TIMESTAMPTZ_OID = 1184;

const SCHEMA_LOCK = 724031; // 여러 서버가 동시에 켜져도 표 만들기를 한 번에 하나씩

// 접속 주소를 고르는 순서: DATABASE_URL → POSTGRES_URL(Supabase 연동이 넣는 이름)
export function databaseUrlFromEnv(env = process.env) {
  return env.DATABASE_URL || env.POSTGRES_URL || '';
}

// 주소의 sslmode 같은 SSL 설정은 지우고 SSL 은 아래 ssl 옵션으로만 정한다.
// (pg 는 주소의 sslmode=require 를 '인증서 끝까지 검증'으로 읽어
//  Supabase 연결이 self-signed certificate 오류로 실패한다.)
export function pgConfig(url) {
  const u = new URL(url);
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname);
  const disabled = u.searchParams.get('sslmode') === 'disable';
  for (const k of [...u.searchParams.keys()]) {
    if (k.startsWith('ssl') || k === 'supa') u.searchParams.delete(k);
  }
  return {
    connectionString: u.toString(),
    ssl: local || disabled ? undefined : { rejectUnauthorized: false },
  };
}

export async function openDb({ url = databaseUrlFromEnv(), dataDir } = {}) {
  const schema = SCHEMA_SQL;
  // Vercel 에서는 파일이 남지 않으므로 접속 주소 없이 켜지면 자료가 사라진다. 아예 막는다.
  if (!url && process.env.VERCEL) {
    const err = new Error('데이터베이스 접속 주소(POSTGRES_URL 또는 DATABASE_URL)가 없습니다. Vercel 프로젝트에 Supabase를 연결하세요.');
    err.code = 'NO_DATABASE_URL';
    throw err;
  }

  if (url) {
    const pg = (await import('pg')).default;
    pg.types.setTypeParser(DATE_OID, asDate);
    pg.types.setTypeParser(TIMESTAMPTZ_OID, toIso);
    const pool = new pg.Pool({ ...pgConfig(url), max: 3, idleTimeoutMillis: 10000 });
    // 쉬고 있던 연결을 DB 쪽(Supabase 연결 풀 등)이 끊으면 'error' 이벤트가 온다.
    // 처리기가 없으면 Node 프로세스가 통째로 죽어 Vercel 에서 FUNCTION_INVOCATION_FAILED 가 된다.
    pool.on('error', (err) => {
      console.error('[db] 쉬던 연결이 끊김 (다음 요청 때 새로 연결):', err.code ?? '', (err.message ?? '').split('\n')[0]);
    });
    // Supabase 연결 풀(트랜잭션 모드)에서도 안전하도록 트랜잭션 안에서만 잠그고 표를 만든다
    const setup = await pool.connect();
    try {
      await setup.query('BEGIN');
      await setup.query('SELECT pg_advisory_xact_lock($1)', [SCHEMA_LOCK]);
      await setup.query(schema);
      await setup.query('COMMIT');
    } catch (e) {
      await setup.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      setup.release();
    }
    const run = (client) => async (sql, params = []) => (await client.query(sql, params)).rows;
    return {
      kind: 'postgres',
      query: run(pool),
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const out = await fn(run(client));
          await client.query('COMMIT');
          return out;
        } catch (e) {
          await client.query('ROLLBACK').catch(() => {});
          throw e;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const dir = dataDir ?? process.env.PGLITE_DIR ?? './.data/pglite';
  // PGlite 는 상위 폴더(.data)가 없으면 만들지 못하고 죽는다. 새로 받은 폴더에서도 npm start 가 되도록 먼저 만든다
  if (!dir.includes('://')) (await import('node:fs')).mkdirSync(dir, { recursive: true });
  const db = new PGlite(dir, {
    parsers: { [DATE_OID]: asDate, [TIMESTAMPTZ_OID]: toIso },
  });
  await db.exec(schema);
  const run = (conn) => async (sql, params = []) => (await conn.query(sql, params)).rows;
  return {
    kind: 'pglite',
    query: run(db),
    tx: (fn) => db.transaction((t) => fn(run(t))),
    close: () => db.close(),
  };
}
