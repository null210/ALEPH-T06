# PDS 플래너

계획(Plan)을 세우고, 할 일과 실제로 한 일(Do)을 기록하고, 돌아보기(See)로 다음 계획을 고치는 할 일 관리 웹앱입니다.
로그인 없이 링크만으로 열리며, 모든 자료는 서버의 PostgreSQL 데이터베이스에 저장됩니다.

> 지금은 로그인이 없어 링크를 아는 사람은 누구나 볼 수 있습니다. 남이 봐도 괜찮은 내용만 넣으세요.

- 결과물: `https://(배포 주소를 여기에)`
- 소스: `https://github.com/(내 계정)/pds-planner`

## 짧은 확인 방법

**① 어디로 가나요**
새 시크릿 창에서 결과물 주소를 엽니다. 로그인·가입 화면 없이 바로 "내 계획" 목록이 보입니다.

**② 세 단계 안에 무엇을 하나요**
1. 목록에서 계획을 누릅니다.
2. "돌아보기" 탭을 누릅니다.
3. "지연" 숫자를 누릅니다.

**③ 무엇이 보이면 통과인가요**
- 2단계에서 계획·완료·지연·막힘 수와 예상·실제·차이(분)가 보이고, 모두 0은 아닙니다.
- 3단계에서 "돌아보기의 '지연'에 들어간 할 일 N건만 보는 중"이 뜨고, 보이는 할 일 수가 그 숫자 N과 같으며, 모두 빨간 "지연" 표시가 붙어 있습니다.
- 화면 위쪽에 노란 공개 안내 문구가 보입니다.

**④ 안 될 때는 무엇이 보이나요**
- 서버가 잠들어 있으면 첫 접속에 30초~1분 정도 "불러오는 중…"이 보입니다. 기다린 뒤 새로고침하세요.
- 데이터베이스에 연결하지 못하면 "화면을 열 수 없습니다 / 서버에서 문제가 생겼습니다" 안내가 보입니다. `/api/health`를 열면 `{"ok":true,"database":"postgres"}`가 아니라 오류가 보입니다.

## 체크리스트와 구현 위치

| 항목 | 어디서 확인하나요 |
|---|---|
| C04–C07 계획의 기간·우선순위·성공 기준·예상 시간 | 계획 화면 머리, `plans` 표 |
| C08 고치기 전 계획 보존 | "계획 고치기 · 이전 버전" 탭, `plan_versions` 표 |
| C09–C17 할 일 만들기·고치기·완료·되돌리기·지우기, 마감일·우선순위·태그·예상 시간 | "할 일" 탭 |
| C18–C20 검색·거르기·정렬, 정렬 기준 표시 | "할 일" 탭 도구줄과 회색 "정렬 기준" 줄 |
| C21–C22 완료 연타 시 한 건 | 버튼 잠금 + 서버의 조건부 갱신 + `task_completions` 부분 유일 인덱스 |
| C23–C27 실행 기록 | 할 일의 "실행 기록" 버튼, "실행 기록" 탭, `work_logs` 표 |
| C28–C32, C83 돌아보기 집계와 숫자 누르기 | "돌아보기" 탭 (정의는 `contracts/pds-schema-v2.json`의 `review_metrics`) |
| C33 고칠 점을 다음 계획으로 | 돌아보기 저장 → "이 고칠 점으로 다음 계획 만들기" |
| C34–C35 실제 DB 저장·복원 | PostgreSQL, 날짜는 `YYYY-MM-DD` 문자열로 그대로 |
| C36 내보내기 | 오른쪽 위 "내 자료 전체 내보내기" (`/api/export`) |
| C57 스크립트 글자 무력화 | 화면은 `textContent`만 사용, CSP로 인라인 스크립트 차단 |
| C58 비밀키 | 접속 주소는 서버 환경 변수에만, `npm run check:secrets` |
| C82 공개 안내 | 모든 화면 위쪽 노란 줄 |

자동 테스트(`npm test`)는 위 항목 이름(T06-Cxx)을 그대로 테스트 이름으로 씁니다.

## 로컬에서 실행

Node.js 20 이상이 필요합니다.

```bash
npm ci
npm start          # http://localhost:3000
npm test           # 체크리스트 자동 테스트
```

`DATABASE_URL`이 없으면 `./.data/pglite`에 PostgreSQL과 같은 엔진(PGlite)으로 파일 데이터베이스를 만듭니다.

## 배포 (무료, 로그인 없이 열리는 주소 만들기)

1. **GitHub**: 새 저장소를 **Public**으로 만들고 이 폴더를 올립니다.
2. **데이터베이스 (Neon)**: neon.tech에서 무료 프로젝트를 만들고 접속 주소(`postgresql://...?sslmode=require`)를 복사합니다.
3. **서버 (Render)**: render.com → New → Blueprint → 이 저장소를 고릅니다. `DATABASE_URL` 값을 물으면 2번 주소를 붙여 넣습니다.
4. 배포가 끝나면 `https://pds-planner-xxxx.onrender.com/api/health`가 `{"ok":true,"database":"postgres"}`인지 확인합니다.
5. 위의 결과물·소스 주소를 이 README 맨 위에 적습니다.

접속 주소는 Render의 환경 변수 화면에만 넣고, 파일이나 커밋에 적지 않습니다. `.env`는 `.gitignore`에 들어 있습니다.

## 내 자료 넣기

카드 1에서 세운 실제 계획을 넣습니다 (계획 1개, 할 일 5개 이상, 실행 기록 3개 이상).

- 화면에서 직접 넣어도 되고,
- `seed/my-data.example.json`을 `seed/my-data.json`으로 복사해 내용을 바꾼 뒤 한 번에 넣을 수도 있습니다.

```bash
node scripts/seed.js seed/my-data.json https://pds-planner-xxxx.onrender.com
```

`seed/my-data.json`은 Git에 올라가지 않습니다.

## 폴더

```
contracts/pds-schema-v2.json   표·항목·관계·날짜 규칙
server/schema.sql              실제 표를 만드는 SQL
server/app.js                  API (검사 규칙, 집계)
server/db.js                   PostgreSQL / PGlite 연결
public/                        화면 (HTML·CSS·JS, 빌드 없음)
scripts/seed.js                내 자료 넣기
scripts/check-secrets.js       비밀키 검사
test/api.test.js               체크리스트 자동 테스트
```
