// Vercel 진입 파일. Vercel 은 이 파일의 기본 내보내기(Express 앱)를 함수 하나로 실행한다.
// 화면 파일(public/)은 Vercel CDN 이 바로 내보내고, 보안 헤더는 vercel.json 에서 붙인다.
// 로컬에서는 npm start(server/index.js)를 쓴다.
//
// DB 연결은 첫 요청 때 한다. 연결에 실패해도 함수가 죽지 않고,
// 무엇이 잘못됐는지(비밀값 없이) 503 응답으로 알려 준다. 다음 요청 때 다시 시도한다.
import express from 'express';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';

// 접속 주소나 비밀번호는 담지 않고, 고칠 방법만 알려 준다
function explain(err) {
  const byCode = {
    NO_DATABASE_URL: 'DATABASE_URL 환경 변수가 없습니다. Vercel 프로젝트의 Storage 탭에서 Neon을 연결한 뒤 Redeploy 하세요.',
    ENOTFOUND: 'DATABASE_URL 의 서버 주소를 찾을 수 없습니다. Neon 접속 주소를 다시 복사해 넣으세요.',
    ECONNREFUSED: '데이터베이스 서버가 연결을 거절했습니다. DATABASE_URL 의 주소와 포트를 확인하세요.',
    ETIMEDOUT: '데이터베이스 서버가 응답하지 않습니다. Neon 프로젝트가 켜져 있는지 확인하세요.',
    '28P01': '데이터베이스 사용자 이름이나 비밀번호가 맞지 않습니다. Neon 접속 주소를 다시 넣으세요.',
    '3D000': 'DATABASE_URL 에 적힌 데이터베이스가 없습니다.',
    ERR_INVALID_URL: 'DATABASE_URL 형식이 잘못되었습니다. postgresql:// 로 시작하는 주소여야 합니다.',
  };
  const code = err.code ?? (/Invalid URL/i.test(err.message ?? '') ? 'ERR_INVALID_URL' : 'UNKNOWN');
  return { code, error: byCode[code] ?? '데이터베이스에 연결하지 못했습니다. Vercel 의 Runtime Logs 에서 자세한 내용을 확인하세요.' };
}

let ready = null;
function getInner() {
  ready ??= openDb()
    .then((db) => createApp(db))
    .catch((err) => {
      ready = null; // 다음 요청 때 다시 시도
      console.error('[db] 연결 실패:', err.code ?? '', (err.message ?? '').split('\n')[0]);
      throw err;
    });
  return ready;
}

const app = express();
app.disable('x-powered-by');
app.use(async (req, res, next) => {
  let inner;
  try {
    inner = await getInner();
  } catch (err) {
    res.set('Cache-Control', 'no-store');
    return res.status(503).json({ ok: false, ...explain(err) });
  }
  return inner(req, res, next);
});

export default app;
