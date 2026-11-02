import { openDb } from './db.js';
import { createApp } from './app.js';

const port = Number(process.env.PORT) || 3000;
const db = await openDb();
const app = createApp(db);

app.listen(port, () => {
  console.log(`PDS 플래너: http://localhost:${port} (데이터베이스: ${db.kind})`);
});
