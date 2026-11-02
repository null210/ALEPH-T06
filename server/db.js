// 데이터베이스 연결.
// - 배포: 환경 변수 DATABASE_URL 이 있으면 PostgreSQL 서버에 연결한다.
// - 로컬/테스트: 없으면 PGlite(같은 PostgreSQL 엔진을 파일로 돌리는 것)를 쓴다.
// 접속 주소(비밀값)는 서버 환경 변수에만 있고, 브라우저나 응답·로그로 나가지 않는다.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

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

export async function openDb({ url = process.env.DATABASE_URL, dataDir } = {}) {
  const schema = await readFile(path.join(here, 'schema.sql'), 'utf8');

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
    await pool.query(schema);
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
