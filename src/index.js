// Vercel 진입 파일. Vercel 은 이 파일의 기본 내보내기(Express 앱)를 함수 하나로 실행한다.
// 화면 파일(public/)은 Vercel CDN 이 바로 내보내고, 보안 헤더는 vercel.json 에서 붙인다.
// 로컬에서는 npm start(server/index.js)를 쓴다.
import express from 'express';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';

const db = await openDb();
const app = express();
app.use(createApp(db));

export default app;
