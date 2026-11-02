// 데이터베이스 연결.
// - 배포: 환경 변수 DATABASE_URL 이 있으면 PostgreSQL 서버에 연결한다.
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

export async function openDb({ url = process.env.DATABASE_URL, dataDir } = {}) {
  const schema = SCHEMA_SQL;
  // Vercel 에서는 파일이 남지 않으므로 DATABASE_URL 없이 켜지면 자료가 사라진다. 아예 막는다.
  if (!url && process.env.VERCEL) {
    const err = new Error('DATABASE_URL 환경 변수가 없습니다. Vercel 프로젝트 설정에서 PostgreSQL(Neon)을 연결하세요.');
    err.code = 'NO_DATABASE_URL';
    throw err;
  }

  if (url) {
    const pg = (await import('pg')).default;
    pg.types.setTypeParser(DATE_OID, asDate);
    pg.types.setTypeParser(TIMESTAMPTZ_OID, toIso);
    const needsSsl = !/localhost|127\.0\.0\.1/.test(url) && !/sslmode=disable/.test(url);
    const pool = new pg.Pool({
      connectionString: url,
      ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
      max: 5,
    });
    const setup = await pool.connect();
    try {
      await setup.query('SELECT pg_advisory_lock($1)', [SCHEMA_LOCK]);
      await setup.query(schema);
    } finally {
      await setup.query('SELECT pg_advisory_unlock($1)', [SCHEMA_LOCK]).catch(() => {});
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
  const db = new PGlite(dataDir ?? process.env.PGLITE_DIR ?? './.data/pglite', {
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
