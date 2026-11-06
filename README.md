# PDS 플래너

계획(Plan)을 세우고, 할 일과 실제로 한 일(Do)을 기록하고, 돌아보기(See)로 다음 계획을 고치는 할 일 관리 웹앱입니다.
7번 과제에서 가입·로그인을 붙여, **로그인한 본인만 자기 자료를 봅니다.** 모든 자료는 서버의 PostgreSQL 데이터베이스에 저장됩니다.

- 결과물: `https://aleph-t06-omega.vercel.app` — 첫 화면은 로그인 화면
- 소스: `https://github.com/null210/ALEPH-T06`
- 7번 제출문: [SUBMISSION.md](SUBMISSION.md) · 인증 구현 설명서: [docs/AUTH.md](docs/AUTH.md) · 5일 기록: [docs/USAGE_LOG.md](docs/USAGE_LOG.md)

## 인증 (7번)

- 서버 세션 + HttpOnly 쿠키(`pds_sid`, 7일). 비밀번호는 scrypt 해시만, 세션은 토큰의 SHA-256만 DB에 저장합니다.
- `/api/health`, `/api/auth/signup|login|logout` 말고는 로그인해야 열립니다. 남의 자료 ID는 404로 답합니다.
- 흐름: 로그인 → 오늘 할 일·실행 기록 → "오늘 기록"(`#/diary`, 서울 날짜로만 저장, 5일, 3일차 전 규칙 한 번 변경) → 로그아웃
- 계정 화면(`#/account`): 비밀번호 바꾸기(모든 이전 세션 끊김), 계정 지우기(내 자료 모두 함께 삭제)
- 확인 기록 만들기: `node scripts/verify-auth.js [배포 주소]` (시험 계정 두 개를 새로 만들고, 비밀값은 가려서 출력)

## 짧은 확인 방법 (6번 기준 — 7번은 [SUBMISSION.md](SUBMISSION.md))

7번부터는 아래 단계 전에 먼저 가입·로그인합니다.

**① 어디로 가나요**
새 시크릿 창에서 https://aleph-t06-omega.vercel.app 을 엽니다. 로그인·가입 화면 없이 바로 "내 계획" 목록이 보입니다.

**② 세 단계 안에 무엇을 하나요**
1. 목록에서 "T06 PDS 플래너 만들고 배포하기" 계획을 누릅니다.
2. "돌아보기" 탭을 누릅니다.
3. "막힘" 숫자를 누릅니다.

**③ 무엇이 보이면 통과인가요**
- 2단계에서 계획·완료·지연·막힘 수와 예상·실제·차이(분)가 보이고, 숫자가 모두 0은 아닙니다 (예: 계획 7, 완료 4, 막힘 2).
- 3단계에서 "돌아보기의 '막힘'에 들어간 할 일 N건만 보는 중"이 뜨고, 아래 할 일 수가 그 N과 같으며, 모두 "막힘 기록 있음" 표시가 붙어 있습니다.
- 화면 위쪽에 노란 공개 안내 문구가 보입니다.

**④ 안 될 때는 무엇이 보이나요**
- 데이터베이스에 연결하지 못하면 공개 안내 아래에 "화면을 열 수 없습니다"와 "서버에서 문제가 생겼습니다. 잠시 뒤 다시 해 주세요."가 보입니다.
- 이때 https://aleph-t06-omega.vercel.app/api/health 를 열면 `{"ok":true,"database":"postgres"}` 대신 `{"ok":false,"code":"…","error":"…"}`로 원인과 고칠 방법이 보입니다. 접속 주소나 비밀번호는 담기지 않습니다.
- 자료가 지워졌으면 목록에 "아직 계획이 없습니다"가 보입니다.
- Supabase 무료 프로젝트는 오래 안 쓰면 일시 정지(Paused)됩니다. 그때는 Supabase 대시보드에서 Restore 하면 됩니다.

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
| C34–C35 실제 DB 저장·복원 | Supabase PostgreSQL, 날짜는 `YYYY-MM-DD` 문자열로 그대로 |
| C36 내보내기 | 오른쪽 위 "내 자료 전체 내보내기" (`/api/export`) |
| C57 스크립트 글자 무력화 | 화면은 `textContent`만 사용, CSP로 인라인 스크립트 차단 |
| C58 비밀키 | 접속 주소는 Vercel 환경 변수에만, 화면 코드는 Supabase 키를 쓰지 않음, `npm run check:secrets` (GitHub Actions가 푸시마다 실행) |
| C82 공개 안내 → 7번 | 모든 화면 위쪽 노란 줄. 7번부터 "내 자료는 로그인한 본인에게만 보입니다" |
| 7번 가입·로그인·남의 자료 막기 | `server/auth.js`, `test/auth.test.js`, [docs/AUTH.md](docs/AUTH.md) |

자동 테스트(`npm test`)는 위 항목 이름(T06-Cxx)을 그대로 테스트 이름으로 씁니다.

## 로컬에서 실행

Node.js 22가 필요합니다 (Vercel도 22.x로 고정).

```bash
npm ci
npm start          # http://localhost:3000
npm test           # 체크리스트 자동 테스트
```

`DATABASE_URL`·`POSTGRES_URL`이 없으면 `./.data/pglite`에 PostgreSQL과 같은 엔진(PGlite)으로 파일 데이터베이스를 만듭니다.

## 배포 (Vercel + Supabase, 무료)

1. **GitHub**: 저장소를 **Public**으로 둡니다. 푸시할 때마다 Actions 탭에서 "검사"(테스트 + 비밀키 검사)가 돌아갑니다.
2. **Vercel**: Add New → Project → 이 저장소를 Import → Deploy 합니다.
   - Vercel이 `src/index.js`를 Express 앱으로, `public/`을 화면 파일로 알아서 찾습니다.
3. **Supabase 연결**: Vercel 프로젝트 → **Storage** → Create Database → **Supabase**를 고르고 이 프로젝트에 연결합니다.
   - Storage 목록에 없으면 vercel.com/marketplace/supabase 에서 설치한 뒤 이 프로젝트를 고릅니다.
   - 연결하면 `POSTGRES_URL`을 비롯한 환경 변수가 프로젝트에 자동으로 들어갑니다. 코드는 `POSTGRES_URL`을 씁니다.
   - 지역은 서울(Northeast Asia, Seoul)을 고르면 빠릅니다.
4. **Redeploy**: Deployments → 최신 배포의 ⋯ → Redeploy. 환경 변수는 새 배포에만 적용됩니다.
5. `https://aleph-t06-omega.vercel.app/api/health`가 `{"ok":true,"database":"postgres"}`이면 끝입니다. 표는 첫 요청 때 자동으로 만들어집니다.
6. **새 시크릿 창**에서 https://aleph-t06-omega.vercel.app 이 열어 로그인 화면이 먼저 나오는지 확인합니다.

이미 만든 Supabase 프로젝트를 쓰고 싶으면 3번 대신 Supabase 대시보드의 Connect → Transaction pooler 주소(포트 6543)를 복사해, Vercel의 Environment Variables에 `DATABASE_URL`이라는 이름으로 넣고 Redeploy 합니다.

(7번) 6번 때 넣은 자료를 내 계정으로 가져오려면 Environment Variables에 `OWNER_EMAIL`(내 이메일)을 넣고 Redeploy 한 뒤, **곧바로** 그 이메일로 가입합니다. 넣지 않으면 옛 자료는 아무에게도 보이지 않습니다.

주의할 점
- 제출 주소는 프로덕션 주소(`aleph-t06-omega.vercel.app`)입니다. 배포마다 생기는 긴 미리보기 주소는 Vercel 로그인을 요구할 수 있습니다 (C01).
- 접속 주소와 Supabase 키는 Vercel 환경 변수에만 있습니다. 화면 코드(`public/`)는 Supabase를 직접 부르지 않아 키가 브라우저로 가지 않습니다. `NEXT_PUBLIC_` 변수가 생겨도 이 프로젝트는 빌드에 넣지 않습니다.
- 모든 표에 행 수준 보안(RLS)을 켜 두어, Supabase의 자동 REST API로는 표를 읽거나 쓸 수 없습니다. 이 서버는 표 주인이라 영향이 없습니다.
- 접속 주소 없이 Vercel에서 켜지면 서버가 일부러 DB를 쓰지 않고 `/api/health`에 이유를 보여 줍니다. 자료가 사라지는 임시 저장을 막기 위해서입니다.
- Vercel에서는 화면 파일을 CDN이 내보내므로 보안 헤더(CSP)를 `vercel.json`에도 같은 값으로 넣었고, 테스트가 두 값이 같은지 확인합니다.

## 내 자료 넣기

카드 1에서 세운 실제 계획을 넣습니다 (계획 1개, 할 일 5개 이상, 실행 기록 3개 이상).

- 화면에서 직접 넣어도 되고,
- `seed/my-data.example.json`을 `seed/my-data.json`으로 복사해 내용을 바꾼 뒤 한 번에 넣을 수도 있습니다.

```bash
PDS_EMAIL=내@메일 PDS_PASSWORD='내 비밀번호' node scripts/seed.js seed/my-data.json https://aleph-t06-omega.vercel.app
```

7번부터는 로그인한 계정으로 넣습니다. 비밀번호는 환경 변수로만 받고 화면에 찍지 않습니다. 셸 기록에 남기 싫으면 `read -s PDS_PASSWORD; export PDS_PASSWORD`로 넣으세요.

`seed/my-data.json`은 Git에 올라가지 않습니다.

## 폴더

```
contracts/pds-schema-v2.json   표·항목·관계·날짜 규칙
server/schema.js               실제 표를 만드는 SQL
server/app.js                  API (검사 규칙, 집계, 모든 조회에 주인 조건)
server/auth.js                 가입·로그인·로그아웃·비밀번호 변경·계정 삭제, 로그인 검사, CSRF 검사
server/diary.js                5일 기록 (오늘 기록, 규칙 변경, 전후 비교)
server/db.js                   PostgreSQL / PGlite 연결
server/index.js                로컬 실행 (npm start)
src/index.js                   Vercel 진입 파일
vercel.json                    Vercel 보안 헤더
.github/workflows/ci.yml       푸시마다 테스트·비밀키 검사
public/                        화면 (HTML·CSS·JS, 빌드 없음)
scripts/seed.js                내 자료 넣기
scripts/check-secrets.js       비밀키 검사 (세션 쿠키 원문·비밀번호 저장값 포함)
scripts/verify-auth.js         인증 확인 기록 만들기 (요청·응답, 비밀값 가림)
test/api.test.js               체크리스트 자동 테스트
test/auth.test.js              7번 인증 자동 테스트
test/diary.test.js             7번 5일 기록·비밀번호 변경·계정 삭제 테스트
docs/                          7번 설명서·확인 기록·5일 기록
```
