# 인증 확인 기록 (배포 사이트)

- 실행 시각: 2026-11-06T02:49:29.089Z (UTC)
- 대상: https://aleph-t06-zeta.vercel.app
- 시험 계정: A = verify-a-5a4a95@example.com, B = verify-b-5a4a95@example.com. 이번 실행에서 새로 만들었고, 마지막(ㅈ)에 둘 다 지웠습니다.
- A와 B는 일부러 **같은 비밀번호**로 만들었습니다(ㅇ에서 저장값이 서로 다른지 봅니다).
- 가린 값: 비밀번호와 세션 쿠키는 앞 5글자만 남기고 "…생략"으로 가렸습니다. 비밀번호 원문은 이 문서 어디에도 없습니다.

### ㄱ. 가입·로그인 (같은 이메일 두 번 가입, 틀린 비밀번호, 없는 이메일)

#### 1. A 가입 — ✅ 예상대로

```http
POST /api/auth/signup
Cookie: (보내지 않음)

{"email":"verify-a-5a4a95@example.com","password":"Pw-iE…생략"}
```
```http
HTTP 201
Set-Cookie: pds_sid=1yyGZ…생략; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure

{"user":{"id":"b9580fa0-55f6-4483-8b81-7efce0af4eac","email":"verify-a-5a4a95@example.com"}}
```

#### 2. B 가입 (A와 같은 비밀번호) — ✅ 예상대로

```http
POST /api/auth/signup
Cookie: (보내지 않음)

{"email":"verify-b-5a4a95@example.com","password":"Pw-iE…생략"}
```
```http
HTTP 201
Set-Cookie: pds_sid=5CIsY…생략; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure

{"user":{"id":"28159914-88c2-421d-abe5-de08b7ef5d28","email":"verify-b-5a4a95@example.com"}}
```

#### 3. 같은 이메일로 다시 가입 → 거절 — ✅ 예상대로

```http
POST /api/auth/signup
Cookie: (보내지 않음)

{"email":"verify-a-5a4a95@example.com","password":"Pw-iE…생략"}
```
```http
HTTP 409

{"error":"이미 가입된 이메일입니다. 로그인해 주세요."}
```

#### 4. A 이메일 + 틀린 비밀번호로 로그인 → 거절 — ✅ 예상대로

```http
POST /api/auth/login
Cookie: (보내지 않음)

{"email":"verify-a-5a4a95@example.com","password":"wrong…생략"}
```
```http
HTTP 401

{"error":"이메일 또는 비밀번호가 맞지 않습니다."}
```

#### 5. 없는 이메일로 로그인 → 위와 같은 문장으로 거절 — ✅ 예상대로

```http
POST /api/auth/login
Cookie: (보내지 않음)

{"email":"nobody-5a4a95@example.com","password":"wrong…생략"}
```
```http
HTTP 401

{"error":"이메일 또는 비밀번호가 맞지 않습니다."}
```

#### 6. A 맞는 비밀번호로 로그인 → 새 세션 — ✅ 예상대로

```http
POST /api/auth/login
Cookie: (보내지 않음)

{"email":"verify-a-5a4a95@example.com","password":"Pw-iE…생략"}
```
```http
HTTP 200
Set-Cookie: pds_sid=JuY8S…생략; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure

{"user":{"id":"b9580fa0-55f6-4483-8b81-7efce0af4eac","email":"verify-a-5a4a95@example.com"}}
```

### ㄴ. [확인 1] 로그인 없이 자료 요청 — 성공(로그인함)과 거절(로그인 안 함)

#### 7. [성공] A의 쿠키로 계획 목록 — ✅ 예상대로

```http
GET /api/plans
Cookie: pds_sid=JuY8S…생략   ← A의 세션
```
```http
HTTP 200

[ 0건 ] []
```

#### 8. [거절] 같은 주소, 쿠키 없이 — ✅ 예상대로

```http
GET /api/plans
Cookie: (보내지 않음)
```
```http
HTTP 401

{"error":"로그인이 필요합니다."}
```

#### 9. [거절] 쿠키 없이 전체 내보내기 — ✅ 예상대로

```http
GET /api/export
Cookie: (보내지 않음)
```
```http
HTTP 401

{"error":"로그인이 필요합니다."}
```

#### 10. [거절] 쿠키 없이 오늘 기록 쓰기 — ✅ 예상대로

```http
PUT /api/diary/today
Cookie: (보내지 않음)

{"value":1}
```
```http
HTTP 401

{"error":"로그인이 필요합니다."}
```

#### 11. [거절] 지어낸 쿠키로 계획 목록 — ✅ 예상대로

```http
GET /api/plans
Cookie: pds_sid=not-a-real-token
```
```http
HTTP 401
Set-Cookie: pds_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure

{"error":"로그인이 필요합니다. (로그아웃했거나 기간이 지났습니다)"}
```

### ㄷ. 두 계정에 자료 넣기 (성공해야 정상)

#### 12. A가 계획 만들기 — ✅ 예상대로

```http
POST /api/plans
Cookie: pds_sid=JuY8S…생략   ← A의 세션

{"start_date":"2026-11-06","end_date":"2026-11-10","priority":1,"success_criteria":"확인용","estimate_minutes":60,"title":"A의 비밀 계획"}
```
```http
HTTP 201

{"id":"487f3ae6-79be-4cb0-87d3-beaa899644c3","title":"A의 비밀 계획","user_id":"b9580fa0-55f6-4483-8b81-7efce0af4eac","version":1}
```

#### 13. A가 할 일 만들기 — ✅ 예상대로

```http
POST /api/plans/487f3ae6-79be-4cb0-87d3-beaa899644c3/tasks
Cookie: pds_sid=JuY8S…생략   ← A의 세션

{"title":"A의 할 일","due_date":"2026-11-07","priority":2,"estimate_minutes":30}
```
```http
HTTP 201

{"id":"9d1e5fca-b7b3-44fc-ade4-8dfdcafe9209","plan_id":"487f3ae6-79be-4cb0-87d3-beaa899644c3","title":"A의 할 일","status":"in_progress","due_date":"2026-11-07","priority":2,"tags":[],"estimate_minutes":30,"completed_at":null,"deleted_at":null,"created_at":"2026-11-06T02:49:40.385Z","updated_at":"2026-11-06T02:49:40.385Z","actual_minutes":0,"log_count":0,"is_blocked":false}
```

#### 14. A가 돌아보기 저장 — ✅ 예상대로

```http
POST /api/plans/487f3ae6-79be-4cb0-87d3-beaa899644c3/reviews
Cookie: pds_sid=JuY8S…생략   ← A의 세션

{"improvement":"A의 고칠 점"}
```
```http
HTTP 201

{"id":"a26e0d03-d774-4c23-b2ba-6e07b0bf760d","plan_id":"487f3ae6-79be-4cb0-87d3-beaa899644c3","improvement":"A의 고칠 점","summary":{"today":"2026-11-06","blocked":0,"overdue":0,"planned":1,"completed":0,"time_zone":"Asia/Seoul","diff_minutes":-30,"actual_minutes":0,"estimate_minutes":30},"created_at":"2026-11-06T02:49:41.697Z"}
```

#### 15. B가 계획 만들기 — ✅ 예상대로

```http
POST /api/plans
Cookie: pds_sid=5CIsY…생략   ← B의 세션

{"start_date":"2026-11-06","end_date":"2026-11-10","priority":1,"success_criteria":"확인용","estimate_minutes":60,"title":"B의 비밀 계획"}
```
```http
HTTP 201

{"id":"e5c33f7e-b438-4a5a-8bbc-d159ad7e95c7","title":"B의 비밀 계획","user_id":"28159914-88c2-421d-abe5-de08b7ef5d28","version":1}
```

#### 16. B가 할 일 만들기 — ✅ 예상대로

```http
POST /api/plans/e5c33f7e-b438-4a5a-8bbc-d159ad7e95c7/tasks
Cookie: pds_sid=5CIsY…생략   ← B의 세션

{"title":"B의 할 일","due_date":"2026-11-07","priority":2,"estimate_minutes":30}
```
```http
HTTP 201

{"id":"0e54517d-6e4c-4e63-b5a1-a5ddca9d5474","plan_id":"e5c33f7e-b438-4a5a-8bbc-d159ad7e95c7","title":"B의 할 일","status":"in_progress","due_date":"2026-11-07","priority":2,"tags":[],"estimate_minutes":30,"completed_at":null,"deleted_at":null,"created_at":"2026-11-06T02:49:43.253Z","updated_at":"2026-11-06T02:49:43.253Z","actual_minutes":0,"log_count":0,"is_blocked":false}
```

#### 17. B가 돌아보기 저장 — ✅ 예상대로

```http
POST /api/plans/e5c33f7e-b438-4a5a-8bbc-d159ad7e95c7/reviews
Cookie: pds_sid=5CIsY…생략   ← B의 세션

{"improvement":"B의 고칠 점"}
```
```http
HTTP 201

{"id":"09734091-69ad-422d-9035-ca758380ef3a","plan_id":"e5c33f7e-b438-4a5a-8bbc-d159ad7e95c7","improvement":"B의 고칠 점","summary":{"today":"2026-11-06","blocked":0,"overdue":0,"planned":1,"completed":0,"time_zone":"Asia/Seoul","diff_minutes":-30,"actual_minutes":0,"estimate_minutes":30},"created_at":"2026-11-06T02:49:44.515Z"}
```

#### 18. A의 고칠 점 목록 (A 것 1건) — ✅ 예상대로

```http
GET /api/reviews
Cookie: pds_sid=JuY8S…생략   ← A의 세션
```
```http
HTTP 200

[ 1건 ] ["A의 고칠 점"]
```

### ㄹ. [확인 2] A가 B의 자료 읽기·고치기·지우기 → 모두 거절 (A → B)

#### 19. [성공] 주인 B가 자기 계획 읽기 — ✅ 예상대로

```http
GET /api/plans/e5c33f7e-b438-4a5a-8bbc-d159ad7e95c7
Cookie: pds_sid=5CIsY…생략   ← B의 세션
```
```http
HTTP 200

{"id":"e5c33f7e-b438-4a5a-8bbc-d159ad7e95c7","title":"B의 비밀 계획","user_id":"28159914-88c2-421d-abe5-de08b7ef5d28","version":1}
```

#### 20. [거절·읽기] A가 같은 주소로 B 계획 읽기 — ✅ 예상대로

```http
GET /api/plans/e5c33f7e-b438-4a5a-8bbc-d159ad7e95c7
Cookie: pds_sid=JuY8S…생략   ← A의 세션
```
```http
HTTP 404

{"error":"계획을 찾을 수 없습니다."}
```

#### 21. [거절·읽기] A가 B 할 일 목록 읽기 — ✅ 예상대로

```http
GET /api/plans/e5c33f7e-b438-4a5a-8bbc-d159ad7e95c7/tasks
Cookie: pds_sid=JuY8S…생략   ← A의 세션
```
```http
HTTP 404

{"error":"계획을 찾을 수 없습니다."}
```

#### 22. [성공] 주인 B가 자기 할 일 이름 바꾸기 (같은 이름으로 다시 저장) — ✅ 예상대로

```http
PATCH /api/tasks/0e54517d-6e4c-4e63-b5a1-a5ddca9d5474
Cookie: pds_sid=5CIsY…생략   ← B의 세션

{"title":"B의 할 일"}
```
```http
HTTP 200

{"id":"0e54517d-6e4c-4e63-b5a1-a5ddca9d5474","plan_id":"e5c33f7e-b438-4a5a-8bbc-d159ad7e95c7","title":"B의 할 일","status":"in_progress","due_date":"2026-11-07","priority":2,"tags":[],"estimate_minutes":30,"completed_at":null,"deleted_at":null,"created_at":"2026-11-06T02:49:43.253Z","updated_at":"2026-11-06T02:49:52.155Z","actual_minutes":0,"log_count":0,"is_blocked":false}
```

#### 23. [거절·고치기] A가 같은 주소로 B 할 일 이름 바꾸기 — ✅ 예상대로

```http
PATCH /api/tasks/0e54517d-6e4c-4e63-b5a1-a5ddca9d5474
Cookie: pds_sid=JuY8S…생략   ← A의 세션

{"title":"빼앗음"}
```
```http
HTTP 404

{"error":"할 일을 찾을 수 없습니다."}
```

#### 24. [거절·고치기] A가 B 계획 고치기 — ✅ 예상대로

```http
PUT /api/plans/e5c33f7e-b438-4a5a-8bbc-d159ad7e95c7
Cookie: pds_sid=JuY8S…생략   ← A의 세션

{"start_date":"2026-11-06","end_date":"2026-11-10","priority":1,"success_criteria":"확인용","estimate_minutes":60,"title":"빼앗음"}
```
```http
HTTP 404

{"error":"계획을 찾을 수 없습니다."}
```

#### 25. [거절·고치기] A가 B 할 일 완료 누르기 — ✅ 예상대로

```http
POST /api/tasks/0e54517d-6e4c-4e63-b5a1-a5ddca9d5474/complete
Cookie: pds_sid=JuY8S…생략   ← A의 세션
```
```http
HTTP 404

{"error":"할 일을 찾을 수 없습니다."}
```

#### 26. [거절·고치기] A가 B 계획에 할 일 끼워 넣기 — ✅ 예상대로

```http
POST /api/plans/e5c33f7e-b438-4a5a-8bbc-d159ad7e95c7/tasks
Cookie: pds_sid=JuY8S…생략   ← A의 세션

{"title":"끼워 넣기","due_date":"2026-11-07","priority":1,"estimate_minutes":1}
```
```http
HTTP 404

{"error":"계획을 찾을 수 없습니다."}
```

#### 27. [거절·지우기] A가 B 할 일 지우기 — ✅ 예상대로

```http
DELETE /api/tasks/0e54517d-6e4c-4e63-b5a1-a5ddca9d5474
Cookie: pds_sid=JuY8S…생략   ← A의 세션
```
```http
HTTP 404

{"error":"할 일을 찾을 수 없습니다."}
```

#### 28. [거절] A가 B의 돌아보기를 내 다음 계획으로 넘겨받기 — ✅ 예상대로

```http
POST /api/plans
Cookie: pds_sid=JuY8S…생략   ← A의 세션

{"start_date":"2026-11-06","end_date":"2026-11-10","priority":1,"success_criteria":"확인용","estimate_minutes":60,"title":"넘겨받기 시도","carried_review_id":"09734091-69ad-422d-9035-ca758380ef3a"}
```
```http
HTTP 400

{"error":"넘겨받을 돌아보기를 찾을 수 없습니다."}
```

#### 29. A의 계획 목록 — B 것이 하나도 없음 — ✅ 예상대로

```http
GET /api/plans
Cookie: pds_sid=JuY8S…생략   ← A의 세션
```
```http
HTTP 200

[ 1건 ] ["A의 비밀 계획"]
```

#### 30. A의 고칠 점 목록 — B 것이 하나도 없음 — ✅ 예상대로

```http
GET /api/reviews
Cookie: pds_sid=JuY8S…생략   ← A의 세션
```
```http
HTTP 200

[ 1건 ] ["A의 고칠 점"]
```

#### 31. A의 전체 내보내기 — B 것이 하나도 없음 — ✅ 예상대로

```http
GET /api/export
Cookie: pds_sid=JuY8S…생략   ← A의 세션
```
```http
HTTP 200

{"user":{"id":"b9580fa0-55f6-4483-8b81-7efce0af4eac","email":"verify-a-5a4a95@example.com"},"plans":["A의 비밀 계획"],"tasks":["A의 할 일"],"reviews":["A의 고칠 점"],"diary_entries":0}
```

### ㄹ. [확인 2] B가 A의 자료 읽기·고치기·지우기 → 모두 거절 (B → A)

#### 32. [성공] 주인 A가 자기 계획 읽기 — ✅ 예상대로

```http
GET /api/plans/487f3ae6-79be-4cb0-87d3-beaa899644c3
Cookie: pds_sid=JuY8S…생략   ← A의 세션
```
```http
HTTP 200

{"id":"487f3ae6-79be-4cb0-87d3-beaa899644c3","title":"A의 비밀 계획","user_id":"b9580fa0-55f6-4483-8b81-7efce0af4eac","version":1}
```

#### 33. [거절·읽기] B가 같은 주소로 A 계획 읽기 — ✅ 예상대로

```http
GET /api/plans/487f3ae6-79be-4cb0-87d3-beaa899644c3
Cookie: pds_sid=5CIsY…생략   ← B의 세션
```
```http
HTTP 404

{"error":"계획을 찾을 수 없습니다."}
```

#### 34. [거절·읽기] B가 A 할 일 목록 읽기 — ✅ 예상대로

```http
GET /api/plans/487f3ae6-79be-4cb0-87d3-beaa899644c3/tasks
Cookie: pds_sid=5CIsY…생략   ← B의 세션
```
```http
HTTP 404

{"error":"계획을 찾을 수 없습니다."}
```

#### 35. [성공] 주인 A가 자기 할 일 이름 바꾸기 (같은 이름으로 다시 저장) — ✅ 예상대로

```http
PATCH /api/tasks/9d1e5fca-b7b3-44fc-ade4-8dfdcafe9209
Cookie: pds_sid=JuY8S…생략   ← A의 세션

{"title":"A의 할 일"}
```
```http
HTTP 200

{"id":"9d1e5fca-b7b3-44fc-ade4-8dfdcafe9209","plan_id":"487f3ae6-79be-4cb0-87d3-beaa899644c3","title":"A의 할 일","status":"in_progress","due_date":"2026-11-07","priority":2,"tags":[],"estimate_minutes":30,"completed_at":null,"deleted_at":null,"created_at":"2026-11-06T02:49:40.385Z","updated_at":"2026-11-06T02:50:02.194Z","actual_minutes":0,"log_count":0,"is_blocked":false}
```

#### 36. [거절·고치기] B가 같은 주소로 A 할 일 이름 바꾸기 — ✅ 예상대로

```http
PATCH /api/tasks/9d1e5fca-b7b3-44fc-ade4-8dfdcafe9209
Cookie: pds_sid=5CIsY…생략   ← B의 세션

{"title":"빼앗음"}
```
```http
HTTP 404

{"error":"할 일을 찾을 수 없습니다."}
```

#### 37. [거절·고치기] B가 A 계획 고치기 — ✅ 예상대로

```http
PUT /api/plans/487f3ae6-79be-4cb0-87d3-beaa899644c3
Cookie: pds_sid=5CIsY…생략   ← B의 세션

{"start_date":"2026-11-06","end_date":"2026-11-10","priority":1,"success_criteria":"확인용","estimate_minutes":60,"title":"빼앗음"}
```
```http
HTTP 404

{"error":"계획을 찾을 수 없습니다."}
```

#### 38. [거절·고치기] B가 A 할 일 완료 누르기 — ✅ 예상대로

```http
POST /api/tasks/9d1e5fca-b7b3-44fc-ade4-8dfdcafe9209/complete
Cookie: pds_sid=5CIsY…생략   ← B의 세션
```
```http
HTTP 404

{"error":"할 일을 찾을 수 없습니다."}
```

#### 39. [거절·고치기] B가 A 계획에 할 일 끼워 넣기 — ✅ 예상대로

```http
POST /api/plans/487f3ae6-79be-4cb0-87d3-beaa899644c3/tasks
Cookie: pds_sid=5CIsY…생략   ← B의 세션

{"title":"끼워 넣기","due_date":"2026-11-07","priority":1,"estimate_minutes":1}
```
```http
HTTP 404

{"error":"계획을 찾을 수 없습니다."}
```

#### 40. [거절·지우기] B가 A 할 일 지우기 — ✅ 예상대로

```http
DELETE /api/tasks/9d1e5fca-b7b3-44fc-ade4-8dfdcafe9209
Cookie: pds_sid=5CIsY…생략   ← B의 세션
```
```http
HTTP 404

{"error":"할 일을 찾을 수 없습니다."}
```

#### 41. [거절] B가 A의 돌아보기를 내 다음 계획으로 넘겨받기 — ✅ 예상대로

```http
POST /api/plans
Cookie: pds_sid=5CIsY…생략   ← B의 세션

{"start_date":"2026-11-06","end_date":"2026-11-10","priority":1,"success_criteria":"확인용","estimate_minutes":60,"title":"넘겨받기 시도","carried_review_id":"a26e0d03-d774-4c23-b2ba-6e07b0bf760d"}
```
```http
HTTP 400

{"error":"넘겨받을 돌아보기를 찾을 수 없습니다."}
```

#### 42. B의 계획 목록 — A 것이 하나도 없음 — ✅ 예상대로

```http
GET /api/plans
Cookie: pds_sid=5CIsY…생략   ← B의 세션
```
```http
HTTP 200

[ 1건 ] ["B의 비밀 계획"]
```

#### 43. B의 고칠 점 목록 — A 것이 하나도 없음 — ✅ 예상대로

```http
GET /api/reviews
Cookie: pds_sid=5CIsY…생략   ← B의 세션
```
```http
HTTP 200

[ 1건 ] ["B의 고칠 점"]
```

#### 44. B의 전체 내보내기 — A 것이 하나도 없음 — ✅ 예상대로

```http
GET /api/export
Cookie: pds_sid=5CIsY…생략   ← B의 세션
```
```http
HTTP 200

{"user":{"id":"28159914-88c2-421d-abe5-de08b7ef5d28","email":"verify-b-5a4a95@example.com"},"plans":["B의 비밀 계획"],"tasks":["B의 할 일"],"reviews":["B의 고칠 점"],"diary_entries":0}
```

#### 거절 앞뒤로 센 자료 건수 (주인이 자기 쿠키로 센 값)

| 계정 | 거절 전 | 거절 후 | 같은가 |
|---|---|---|---|
| A | {"계획":1,"할일":1,"돌아보기":1,"할일_상태":"A의 할 일/in_progress"} | {"계획":1,"할일":1,"돌아보기":1,"할일_상태":"A의 할 일/in_progress"} | ✅ 같음 |
| B | {"계획":1,"할일":1,"돌아보기":1,"할일_상태":"B의 할 일/in_progress"} | {"계획":1,"할일":1,"돌아보기":1,"할일_상태":"B의 할 일/in_progress"} | ✅ 같음 |

### ㅁ. [확인 3] 주소·헤더·본문에 다른 계정(B의 id 28159914-88c2-421d-abe5-de08b7ef5d28)을 적어 보내기 → 그래도 A 자료만

#### 45. 주소(쿼리)에 B의 id — ✅ 예상대로

```http
GET /api/plans?user_id=28159914-88c2-421d-abe5-de08b7ef5d28
Cookie: pds_sid=JuY8S…생략   ← A의 세션
```
```http
HTTP 200

[ 1건 ] ["A의 비밀 계획"]
```

#### 46. 요청 헤더에 B의 id — ✅ 예상대로

```http
GET /api/plans
Cookie: pds_sid=JuY8S…생략   ← A의 세션
X-User-Id: 28159914-88c2-421d-abe5-de08b7ef5d28
```
```http
HTTP 200

[ 1건 ] ["A의 비밀 계획"]
```

#### 47. 요청 본문에 B의 id를 넣어 계획 만들기 — ✅ 예상대로

```http
POST /api/plans
Cookie: pds_sid=JuY8S…생략   ← A의 세션

{"start_date":"2026-11-06","end_date":"2026-11-10","priority":1,"success_criteria":"확인용","estimate_minutes":60,"title":"A가 B 이름으로 만들려던 계획","user_id":"28159914-88c2-421d-abe5-de08b7ef5d28"}
```
```http
HTTP 201

{"id":"f1c176d6-034d-4b8b-bb61-bcb69f77ba93","title":"A가 B 이름으로 만들려던 계획","user_id":"b9580fa0-55f6-4483-8b81-7efce0af4eac","version":1}
```
> 본문의 user_id 는 무시되고 로그인한 A의 계획으로 만들어집니다(응답의 user_id 를 보세요).

#### 48. B의 계획 목록 — 위 계획이 B에게 생기지 않음 — ✅ 예상대로

```http
GET /api/plans
Cookie: pds_sid=5CIsY…생략   ← B의 세션
```
```http
HTTP 200

[ 1건 ] ["B의 비밀 계획"]
```

### ㅂ. [확인 4] 로그아웃 뒤 같은 값으로 다시 요청 → 거절 (같은 주소·같은 방식)

#### 49. [성공] 로그아웃 전: A의 쿠키로 GET /api/plans — ✅ 예상대로

```http
GET /api/plans
Cookie: pds_sid=JuY8S…생략   ← A의 세션
```
```http
HTTP 200

[ 2건 ] ["A가 B 이름으로 만들려던 계획","A의 비밀 계획"]
```

#### 50. A 로그아웃 — ✅ 예상대로

```http
POST /api/auth/logout
Cookie: pds_sid=JuY8S…생략   ← A의 세션
```
```http
HTTP 204
Set-Cookie: pds_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure
```

#### 51. [거절] 로그아웃 뒤: 똑같은 쿠키 값으로 GET /api/plans — ✅ 예상대로

```http
GET /api/plans
Cookie: pds_sid=JuY8S…생략
```
```http
HTTP 401
Set-Cookie: pds_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure

{"error":"로그인이 필요합니다. (로그아웃했거나 기간이 지났습니다)"}
```

#### 52. [거절] 로그아웃 뒤: 똑같은 쿠키 값으로 계획 만들기 — ✅ 예상대로

```http
POST /api/plans
Cookie: pds_sid=JuY8S…생략

{"start_date":"2026-11-06","end_date":"2026-11-10","priority":1,"success_criteria":"확인용","estimate_minutes":60,"title":"로그아웃 뒤"}
```
```http
HTTP 401
Set-Cookie: pds_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure

{"error":"로그인이 필요합니다. (로그아웃했거나 기간이 지났습니다)"}
```

### ㅅ. [확인 5] 비밀번호를 바꾸면 이전에 발급한 값이 더는 통하지 않음 (같은 주소·같은 방식)

#### 53. [성공] 바꾸기 전: A가 가입할 때 받은 쿠키로 GET /api/plans — ✅ 예상대로

```http
GET /api/plans
Cookie: pds_sid=1yyGZ…생략
```
```http
HTTP 200

[ 2건 ] ["A가 B 이름으로 만들려던 계획","A의 비밀 계획"]
```

#### 54. A 비밀번호 바꾸기 (이 쿠키로 요청) — ✅ 예상대로

```http
POST /api/auth/password
Cookie: pds_sid=1yyGZ…생략

{"current_password":"Pw-iE…생략","new_password":"Nw-je…생략"}
```
```http
HTTP 200
Set-Cookie: pds_sid=9tDoy…생략; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure

{"user":{"id":"b9580fa0-55f6-4483-8b81-7efce0af4eac","email":"verify-a-5a4a95@example.com"}}
```

#### 55. [거절] 바꾼 뒤: 똑같은 예전 쿠키 값으로 GET /api/plans — ✅ 예상대로

```http
GET /api/plans
Cookie: pds_sid=1yyGZ…생략
```
```http
HTTP 401
Set-Cookie: pds_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure

{"error":"로그인이 필요합니다. (로그아웃했거나 기간이 지났습니다)"}
```

#### 56. [성공] 바꿀 때 새로 받은 쿠키로 GET /api/plans — ✅ 예상대로

```http
GET /api/plans
Cookie: pds_sid=9tDoy…생략   ← A의 세션
```
```http
HTTP 200

[ 2건 ] ["A가 B 이름으로 만들려던 계획","A의 비밀 계획"]
```

#### 57. [거절] 예전 비밀번호로 로그인 — ✅ 예상대로

```http
POST /api/auth/login
Cookie: (보내지 않음)

{"email":"verify-a-5a4a95@example.com","password":"Pw-iE…생략"}
```
```http
HTTP 401

{"error":"이메일 또는 비밀번호가 맞지 않습니다."}
```

### ㅇ. 비밀번호 저장값

(배포 사이트에서는 DB 를 직접 읽지 않습니다. 로컬 기록의 ㅇ을 보세요.)

### ㅈ. 계정 지우기 (시험 계정 정리 겸 확인)

#### 58. A 계정 지우기 (틀린 비밀번호) → 거절 — ✅ 예상대로

```http
DELETE /api/auth/account
Cookie: pds_sid=9tDoy…생략   ← A의 세션

{"password":"wrong…생략"}
```
```http
HTTP 400

{"error":"지금 비밀번호가 맞지 않습니다."}
```

#### 59. A 계정 지우기 — ✅ 예상대로

```http
DELETE /api/auth/account
Cookie: pds_sid=9tDoy…생략   ← A의 세션

{"password":"Nw-je…생략"}
```
```http
HTTP 204
Set-Cookie: pds_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure
```

#### 60. [거절] 지운 뒤 같은 쿠키로 계획 목록 — ✅ 예상대로

```http
GET /api/plans
Cookie: pds_sid=9tDoy…생략
```
```http
HTTP 401
Set-Cookie: pds_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure

{"error":"로그인이 필요합니다. (로그아웃했거나 기간이 지났습니다)"}
```

#### 61. [거절] 지운 계정으로 로그인 — ✅ 예상대로

```http
POST /api/auth/login
Cookie: (보내지 않음)

{"email":"verify-a-5a4a95@example.com","password":"Nw-je…생략"}
```
```http
HTTP 401

{"error":"이메일 또는 비밀번호가 맞지 않습니다."}
```

#### 62. B의 계획은 그대로 — ✅ 예상대로

```http
GET /api/plans
Cookie: pds_sid=5CIsY…생략   ← B의 세션
```
```http
HTTP 200

[ 1건 ] ["B의 비밀 계획"]
```

#### 63. B 계정 지우기 (정리) — ✅ 예상대로

```http
DELETE /api/auth/account
Cookie: pds_sid=5CIsY…생략   ← B의 세션

{"password":"Pw-iE…생략"}
```
```http
HTTP 204
Set-Cookie: pds_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure
```

**결과: 63개 요청이 모두 예상한 상태 코드로 응답했고, 거절 앞뒤 건수도 같았습니다.**
