# 인증 확인 기록 (로컬 서버, 빈 메모리 DB)

- 실행 시각: 2026-11-06T01:50:03.749Z (UTC)
- 대상: http://localhost:(임시 포트)
- 시험 계정: A = verify-a-155d93@example.com, B = verify-b-155d93@example.com. 이번 실행에서 새로 만들었고, 마지막(ㅈ)에 둘 다 지웠습니다.
- A와 B는 일부러 **같은 비밀번호**로 만들었습니다(ㅇ에서 저장값이 서로 다른지 봅니다).
- 가린 값: 비밀번호와 세션 쿠키는 앞 5글자만 남기고 "…생략"으로 가렸습니다. 비밀번호 원문은 이 문서 어디에도 없습니다.

### ㄱ. 가입·로그인 (같은 이메일 두 번 가입, 틀린 비밀번호, 없는 이메일)

#### 1. A 가입 — ✅ 예상대로

```http
POST /api/auth/signup
Cookie: (보내지 않음)

{"email":"verify-a-155d93@example.com","password":"Pw-Sa…생략"}
```
```http
HTTP 201
Set-Cookie: pds_sid=hNkG5…생략; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800

{"user":{"id":"83e9bf50-625e-4cfc-bb17-e0707ec464e8","email":"verify-a-155d93@example.com"}}
```

#### 2. B 가입 (A와 같은 비밀번호) — ✅ 예상대로

```http
POST /api/auth/signup
Cookie: (보내지 않음)

{"email":"verify-b-155d93@example.com","password":"Pw-Sa…생략"}
```
```http
HTTP 201
Set-Cookie: pds_sid=J0btl…생략; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800

{"user":{"id":"76133341-90cc-4ed1-981f-6e700bc7ffd4","email":"verify-b-155d93@example.com"}}
```

#### 3. 같은 이메일로 다시 가입 → 거절 — ✅ 예상대로

```http
POST /api/auth/signup
Cookie: (보내지 않음)

{"email":"verify-a-155d93@example.com","password":"Pw-Sa…생략"}
```
```http
HTTP 409

{"error":"이미 가입된 이메일입니다. 로그인해 주세요."}
```

#### 4. A 이메일 + 틀린 비밀번호로 로그인 → 거절 — ✅ 예상대로

```http
POST /api/auth/login
Cookie: (보내지 않음)

{"email":"verify-a-155d93@example.com","password":"wrong…생략"}
```
```http
HTTP 401

{"error":"이메일 또는 비밀번호가 맞지 않습니다."}
```

#### 5. 없는 이메일로 로그인 → 위와 같은 문장으로 거절 — ✅ 예상대로

```http
POST /api/auth/login
Cookie: (보내지 않음)

{"email":"nobody-155d93@example.com","password":"wrong…생략"}
```
```http
HTTP 401

{"error":"이메일 또는 비밀번호가 맞지 않습니다."}
```

#### 6. A 맞는 비밀번호로 로그인 → 새 세션 — ✅ 예상대로

```http
POST /api/auth/login
Cookie: (보내지 않음)

{"email":"verify-a-155d93@example.com","password":"Pw-Sa…생략"}
```
```http
HTTP 200
Set-Cookie: pds_sid=cxm3x…생략; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800

{"user":{"id":"83e9bf50-625e-4cfc-bb17-e0707ec464e8","email":"verify-a-155d93@example.com"}}
```

### ㄴ. [확인 1] 로그인 없이 자료 요청 — 성공(로그인함)과 거절(로그인 안 함)

#### 7. [성공] A의 쿠키로 계획 목록 — ✅ 예상대로

```http
GET /api/plans
Cookie: pds_sid=cxm3x…생략   ← A의 세션
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
Set-Cookie: pds_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0

{"error":"로그인이 필요합니다. (로그아웃했거나 기간이 지났습니다)"}
```

### ㄷ. 두 계정에 자료 넣기 (성공해야 정상)

#### 12. A가 계획 만들기 — ✅ 예상대로

```http
POST /api/plans
Cookie: pds_sid=cxm3x…생략   ← A의 세션

{"start_date":"2026-11-06","end_date":"2026-11-10","priority":1,"success_criteria":"확인용","estimate_minutes":60,"title":"A의 비밀 계획"}
```
```http
HTTP 201

{"id":"248d5a9f-cc7c-43ff-89c6-77d2ce6a7b0e","title":"A의 비밀 계획","user_id":"83e9bf50-625e-4cfc-bb17-e0707ec464e8","version":1}
```

#### 13. A가 할 일 만들기 — ✅ 예상대로

```http
POST /api/plans/248d5a9f-cc7c-43ff-89c6-77d2ce6a7b0e/tasks
Cookie: pds_sid=cxm3x…생략   ← A의 세션

{"title":"A의 할 일","due_date":"2026-11-07","priority":2,"estimate_minutes":30}
```
```http
HTTP 201

{"id":"a3918d96-de5a-45f2-b11d-b68da8122d43","plan_id":"248d5a9f-cc7c-43ff-89c6-77d2ce6a7b0e","title":"A의 할 일","status":"in_progress","due_date":"2026-11-07","priority":2,"tags":[],"estimate_minutes":30,"completed_at":null,"deleted_at":null,"created_at":"2026-11-06T01:50:04.418Z","updated_at":"2026-11-06T01:50:04.418Z","actual_minutes":0,"log_count":0,"is_blocked":false}
```

#### 14. A가 돌아보기 저장 — ✅ 예상대로

```http
POST /api/plans/248d5a9f-cc7c-43ff-89c6-77d2ce6a7b0e/reviews
Cookie: pds_sid=cxm3x…생략   ← A의 세션

{"improvement":"A의 고칠 점"}
```
```http
HTTP 201

{"id":"d6b4a8c2-0231-431a-86dc-a06cdf4631fc","plan_id":"248d5a9f-cc7c-43ff-89c6-77d2ce6a7b0e","improvement":"A의 고칠 점","summary":{"today":"2026-11-06","blocked":0,"overdue":0,"planned":1,"completed":0,"time_zone":"Asia/Seoul","diff_minutes":-30,"actual_minutes":0,"estimate_minutes":30},"created_at":"2026-11-06T01:50:04.442Z"}
```

#### 15. B가 계획 만들기 — ✅ 예상대로

```http
POST /api/plans
Cookie: pds_sid=J0btl…생략   ← B의 세션

{"start_date":"2026-11-06","end_date":"2026-11-10","priority":1,"success_criteria":"확인용","estimate_minutes":60,"title":"B의 비밀 계획"}
```
```http
HTTP 201

{"id":"8e6495b4-cde4-48e8-89f3-7ae9da96c4e8","title":"B의 비밀 계획","user_id":"76133341-90cc-4ed1-981f-6e700bc7ffd4","version":1}
```

#### 16. B가 할 일 만들기 — ✅ 예상대로

```http
POST /api/plans/8e6495b4-cde4-48e8-89f3-7ae9da96c4e8/tasks
Cookie: pds_sid=J0btl…생략   ← B의 세션

{"title":"B의 할 일","due_date":"2026-11-07","priority":2,"estimate_minutes":30}
```
```http
HTTP 201

{"id":"abc84678-b20b-4e17-bec2-6beca7d4f74a","plan_id":"8e6495b4-cde4-48e8-89f3-7ae9da96c4e8","title":"B의 할 일","status":"in_progress","due_date":"2026-11-07","priority":2,"tags":[],"estimate_minutes":30,"completed_at":null,"deleted_at":null,"created_at":"2026-11-06T01:50:04.453Z","updated_at":"2026-11-06T01:50:04.453Z","actual_minutes":0,"log_count":0,"is_blocked":false}
```

#### 17. B가 돌아보기 저장 — ✅ 예상대로

```http
POST /api/plans/8e6495b4-cde4-48e8-89f3-7ae9da96c4e8/reviews
Cookie: pds_sid=J0btl…생략   ← B의 세션

{"improvement":"B의 고칠 점"}
```
```http
HTTP 201

{"id":"a3f4998d-5251-4eb0-9c90-789dadb58431","plan_id":"8e6495b4-cde4-48e8-89f3-7ae9da96c4e8","improvement":"B의 고칠 점","summary":{"today":"2026-11-06","blocked":0,"overdue":0,"planned":1,"completed":0,"time_zone":"Asia/Seoul","diff_minutes":-30,"actual_minutes":0,"estimate_minutes":30},"created_at":"2026-11-06T01:50:04.461Z"}
```

#### 18. A의 고칠 점 목록 (A 것 1건) — ✅ 예상대로

```http
GET /api/reviews
Cookie: pds_sid=cxm3x…생략   ← A의 세션
```
```http
HTTP 200

[ 1건 ] ["A의 고칠 점"]
```

### ㄹ. [확인 2] A가 B의 자료 읽기·고치기·지우기 → 모두 거절 (A → B)

#### 19. [성공] 주인 B가 자기 계획 읽기 — ✅ 예상대로

```http
GET /api/plans/8e6495b4-cde4-48e8-89f3-7ae9da96c4e8
Cookie: pds_sid=J0btl…생략   ← B의 세션
```
```http
HTTP 200

{"id":"8e6495b4-cde4-48e8-89f3-7ae9da96c4e8","title":"B의 비밀 계획","user_id":"76133341-90cc-4ed1-981f-6e700bc7ffd4","version":1}
```

#### 20. [거절·읽기] A가 같은 주소로 B 계획 읽기 — ✅ 예상대로

```http
GET /api/plans/8e6495b4-cde4-48e8-89f3-7ae9da96c4e8
Cookie: pds_sid=cxm3x…생략   ← A의 세션
```
```http
HTTP 404

{"error":"계획을 찾을 수 없습니다."}
```

#### 21. [거절·읽기] A가 B 할 일 목록 읽기 — ✅ 예상대로

```http
GET /api/plans/8e6495b4-cde4-48e8-89f3-7ae9da96c4e8/tasks
Cookie: pds_sid=cxm3x…생략   ← A의 세션
```
```http
HTTP 404

{"error":"계획을 찾을 수 없습니다."}
```

#### 22. [성공] 주인 B가 자기 할 일 이름 바꾸기 (같은 이름으로 다시 저장) — ✅ 예상대로

```http
PATCH /api/tasks/abc84678-b20b-4e17-bec2-6beca7d4f74a
Cookie: pds_sid=J0btl…생략   ← B의 세션

{"title":"B의 할 일"}
```
```http
HTTP 200

{"id":"abc84678-b20b-4e17-bec2-6beca7d4f74a","plan_id":"8e6495b4-cde4-48e8-89f3-7ae9da96c4e8","title":"B의 할 일","status":"in_progress","due_date":"2026-11-07","priority":2,"tags":[],"estimate_minutes":30,"completed_at":null,"deleted_at":null,"created_at":"2026-11-06T01:50:04.453Z","updated_at":"2026-11-06T01:50:04.502Z","actual_minutes":0,"log_count":0,"is_blocked":false}
```

#### 23. [거절·고치기] A가 같은 주소로 B 할 일 이름 바꾸기 — ✅ 예상대로

```http
PATCH /api/tasks/abc84678-b20b-4e17-bec2-6beca7d4f74a
Cookie: pds_sid=cxm3x…생략   ← A의 세션

{"title":"빼앗음"}
```
```http
HTTP 404

{"error":"할 일을 찾을 수 없습니다."}
```

#### 24. [거절·고치기] A가 B 계획 고치기 — ✅ 예상대로

```http
PUT /api/plans/8e6495b4-cde4-48e8-89f3-7ae9da96c4e8
Cookie: pds_sid=cxm3x…생략   ← A의 세션

{"start_date":"2026-11-06","end_date":"2026-11-10","priority":1,"success_criteria":"확인용","estimate_minutes":60,"title":"빼앗음"}
```
```http
HTTP 404

{"error":"계획을 찾을 수 없습니다."}
```

#### 25. [거절·고치기] A가 B 할 일 완료 누르기 — ✅ 예상대로

```http
POST /api/tasks/abc84678-b20b-4e17-bec2-6beca7d4f74a/complete
Cookie: pds_sid=cxm3x…생략   ← A의 세션
```
```http
HTTP 404

{"error":"할 일을 찾을 수 없습니다."}
```

#### 26. [거절·고치기] A가 B 계획에 할 일 끼워 넣기 — ✅ 예상대로

```http
POST /api/plans/8e6495b4-cde4-48e8-89f3-7ae9da96c4e8/tasks
Cookie: pds_sid=cxm3x…생략   ← A의 세션

{"title":"끼워 넣기","due_date":"2026-11-07","priority":1,"estimate_minutes":1}
```
```http
HTTP 404

{"error":"계획을 찾을 수 없습니다."}
```

#### 27. [거절·지우기] A가 B 할 일 지우기 — ✅ 예상대로

```http
DELETE /api/tasks/abc84678-b20b-4e17-bec2-6beca7d4f74a
Cookie: pds_sid=cxm3x…생략   ← A의 세션
```
```http
HTTP 404

{"error":"할 일을 찾을 수 없습니다."}
```

#### 28. [거절] A가 B의 돌아보기를 내 다음 계획으로 넘겨받기 — ✅ 예상대로

```http
POST /api/plans
Cookie: pds_sid=cxm3x…생략   ← A의 세션

{"start_date":"2026-11-06","end_date":"2026-11-10","priority":1,"success_criteria":"확인용","estimate_minutes":60,"title":"넘겨받기 시도","carried_review_id":"a3f4998d-5251-4eb0-9c90-789dadb58431"}
```
```http
HTTP 400

{"error":"넘겨받을 돌아보기를 찾을 수 없습니다."}
```

#### 29. A의 계획 목록 — B 것이 하나도 없음 — ✅ 예상대로

```http
GET /api/plans
Cookie: pds_sid=cxm3x…생략   ← A의 세션
```
```http
HTTP 200

[ 1건 ] ["A의 비밀 계획"]
```

#### 30. A의 고칠 점 목록 — B 것이 하나도 없음 — ✅ 예상대로

```http
GET /api/reviews
Cookie: pds_sid=cxm3x…생략   ← A의 세션
```
```http
HTTP 200

[ 1건 ] ["A의 고칠 점"]
```

#### 31. A의 전체 내보내기 — B 것이 하나도 없음 — ✅ 예상대로

```http
GET /api/export
Cookie: pds_sid=cxm3x…생략   ← A의 세션
```
```http
HTTP 200

{"user":{"id":"83e9bf50-625e-4cfc-bb17-e0707ec464e8","email":"verify-a-155d93@example.com"},"plans":["A의 비밀 계획"],"tasks":["A의 할 일"],"reviews":["A의 고칠 점"],"diary_entries":0}
```

### ㄹ. [확인 2] B가 A의 자료 읽기·고치기·지우기 → 모두 거절 (B → A)

#### 32. [성공] 주인 A가 자기 계획 읽기 — ✅ 예상대로

```http
GET /api/plans/248d5a9f-cc7c-43ff-89c6-77d2ce6a7b0e
Cookie: pds_sid=cxm3x…생략   ← A의 세션
```
```http
HTTP 200

{"id":"248d5a9f-cc7c-43ff-89c6-77d2ce6a7b0e","title":"A의 비밀 계획","user_id":"83e9bf50-625e-4cfc-bb17-e0707ec464e8","version":1}
```

#### 33. [거절·읽기] B가 같은 주소로 A 계획 읽기 — ✅ 예상대로

```http
GET /api/plans/248d5a9f-cc7c-43ff-89c6-77d2ce6a7b0e
Cookie: pds_sid=J0btl…생략   ← B의 세션
```
```http
HTTP 404

{"error":"계획을 찾을 수 없습니다."}
```

#### 34. [거절·읽기] B가 A 할 일 목록 읽기 — ✅ 예상대로

```http
GET /api/plans/248d5a9f-cc7c-43ff-89c6-77d2ce6a7b0e/tasks
Cookie: pds_sid=J0btl…생략   ← B의 세션
```
```http
HTTP 404

{"error":"계획을 찾을 수 없습니다."}
```

#### 35. [성공] 주인 A가 자기 할 일 이름 바꾸기 (같은 이름으로 다시 저장) — ✅ 예상대로

```http
PATCH /api/tasks/a3918d96-de5a-45f2-b11d-b68da8122d43
Cookie: pds_sid=cxm3x…생략   ← A의 세션

{"title":"A의 할 일"}
```
```http
HTTP 200

{"id":"a3918d96-de5a-45f2-b11d-b68da8122d43","plan_id":"248d5a9f-cc7c-43ff-89c6-77d2ce6a7b0e","title":"A의 할 일","status":"in_progress","due_date":"2026-11-07","priority":2,"tags":[],"estimate_minutes":30,"completed_at":null,"deleted_at":null,"created_at":"2026-11-06T01:50:04.418Z","updated_at":"2026-11-06T01:50:04.554Z","actual_minutes":0,"log_count":0,"is_blocked":false}
```

#### 36. [거절·고치기] B가 같은 주소로 A 할 일 이름 바꾸기 — ✅ 예상대로

```http
PATCH /api/tasks/a3918d96-de5a-45f2-b11d-b68da8122d43
Cookie: pds_sid=J0btl…생략   ← B의 세션

{"title":"빼앗음"}
```
```http
HTTP 404

{"error":"할 일을 찾을 수 없습니다."}
```

#### 37. [거절·고치기] B가 A 계획 고치기 — ✅ 예상대로

```http
PUT /api/plans/248d5a9f-cc7c-43ff-89c6-77d2ce6a7b0e
Cookie: pds_sid=J0btl…생략   ← B의 세션

{"start_date":"2026-11-06","end_date":"2026-11-10","priority":1,"success_criteria":"확인용","estimate_minutes":60,"title":"빼앗음"}
```
```http
HTTP 404

{"error":"계획을 찾을 수 없습니다."}
```

#### 38. [거절·고치기] B가 A 할 일 완료 누르기 — ✅ 예상대로

```http
POST /api/tasks/a3918d96-de5a-45f2-b11d-b68da8122d43/complete
Cookie: pds_sid=J0btl…생략   ← B의 세션
```
```http
HTTP 404

{"error":"할 일을 찾을 수 없습니다."}
```

#### 39. [거절·고치기] B가 A 계획에 할 일 끼워 넣기 — ✅ 예상대로

```http
POST /api/plans/248d5a9f-cc7c-43ff-89c6-77d2ce6a7b0e/tasks
Cookie: pds_sid=J0btl…생략   ← B의 세션

{"title":"끼워 넣기","due_date":"2026-11-07","priority":1,"estimate_minutes":1}
```
```http
HTTP 404

{"error":"계획을 찾을 수 없습니다."}
```

#### 40. [거절·지우기] B가 A 할 일 지우기 — ✅ 예상대로

```http
DELETE /api/tasks/a3918d96-de5a-45f2-b11d-b68da8122d43
Cookie: pds_sid=J0btl…생략   ← B의 세션
```
```http
HTTP 404

{"error":"할 일을 찾을 수 없습니다."}
```

#### 41. [거절] B가 A의 돌아보기를 내 다음 계획으로 넘겨받기 — ✅ 예상대로

```http
POST /api/plans
Cookie: pds_sid=J0btl…생략   ← B의 세션

{"start_date":"2026-11-06","end_date":"2026-11-10","priority":1,"success_criteria":"확인용","estimate_minutes":60,"title":"넘겨받기 시도","carried_review_id":"d6b4a8c2-0231-431a-86dc-a06cdf4631fc"}
```
```http
HTTP 400

{"error":"넘겨받을 돌아보기를 찾을 수 없습니다."}
```

#### 42. B의 계획 목록 — A 것이 하나도 없음 — ✅ 예상대로

```http
GET /api/plans
Cookie: pds_sid=J0btl…생략   ← B의 세션
```
```http
HTTP 200

[ 1건 ] ["B의 비밀 계획"]
```

#### 43. B의 고칠 점 목록 — A 것이 하나도 없음 — ✅ 예상대로

```http
GET /api/reviews
Cookie: pds_sid=J0btl…생략   ← B의 세션
```
```http
HTTP 200

[ 1건 ] ["B의 고칠 점"]
```

#### 44. B의 전체 내보내기 — A 것이 하나도 없음 — ✅ 예상대로

```http
GET /api/export
Cookie: pds_sid=J0btl…생략   ← B의 세션
```
```http
HTTP 200

{"user":{"id":"76133341-90cc-4ed1-981f-6e700bc7ffd4","email":"verify-b-155d93@example.com"},"plans":["B의 비밀 계획"],"tasks":["B의 할 일"],"reviews":["B의 고칠 점"],"diary_entries":0}
```

#### 거절 앞뒤로 센 자료 건수 (주인이 자기 쿠키로 센 값)

| 계정 | 거절 전 | 거절 후 | 같은가 |
|---|---|---|---|
| A | {"계획":1,"할일":1,"돌아보기":1,"할일_상태":"A의 할 일/in_progress"} | {"계획":1,"할일":1,"돌아보기":1,"할일_상태":"A의 할 일/in_progress"} | ✅ 같음 |
| B | {"계획":1,"할일":1,"돌아보기":1,"할일_상태":"B의 할 일/in_progress"} | {"계획":1,"할일":1,"돌아보기":1,"할일_상태":"B의 할 일/in_progress"} | ✅ 같음 |

### ㅁ. [확인 3] 주소·헤더·본문에 다른 계정(B의 id 76133341-90cc-4ed1-981f-6e700bc7ffd4)을 적어 보내기 → 그래도 A 자료만

#### 45. 주소(쿼리)에 B의 id — ✅ 예상대로

```http
GET /api/plans?user_id=76133341-90cc-4ed1-981f-6e700bc7ffd4
Cookie: pds_sid=cxm3x…생략   ← A의 세션
```
```http
HTTP 200

[ 1건 ] ["A의 비밀 계획"]
```

#### 46. 요청 헤더에 B의 id — ✅ 예상대로

```http
GET /api/plans
Cookie: pds_sid=cxm3x…생략   ← A의 세션
X-User-Id: 76133341-90cc-4ed1-981f-6e700bc7ffd4
```
```http
HTTP 200

[ 1건 ] ["A의 비밀 계획"]
```

#### 47. 요청 본문에 B의 id를 넣어 계획 만들기 — ✅ 예상대로

```http
POST /api/plans
Cookie: pds_sid=cxm3x…생략   ← A의 세션

{"start_date":"2026-11-06","end_date":"2026-11-10","priority":1,"success_criteria":"확인용","estimate_minutes":60,"title":"A가 B 이름으로 만들려던 계획","user_id":"76133341-90cc-4ed1-981f-6e700bc7ffd4"}
```
```http
HTTP 201

{"id":"29e1995a-8623-46e2-8e68-9b587af83f79","title":"A가 B 이름으로 만들려던 계획","user_id":"83e9bf50-625e-4cfc-bb17-e0707ec464e8","version":1}
```
> 본문의 user_id 는 무시되고 로그인한 A의 계획으로 만들어집니다(응답의 user_id 를 보세요).

#### 48. B의 계획 목록 — 위 계획이 B에게 생기지 않음 — ✅ 예상대로

```http
GET /api/plans
Cookie: pds_sid=J0btl…생략   ← B의 세션
```
```http
HTTP 200

[ 1건 ] ["B의 비밀 계획"]
```

### ㅂ. [확인 4] 로그아웃 뒤 같은 값으로 다시 요청 → 거절 (같은 주소·같은 방식)

#### 49. [성공] 로그아웃 전: A의 쿠키로 GET /api/plans — ✅ 예상대로

```http
GET /api/plans
Cookie: pds_sid=cxm3x…생략   ← A의 세션
```
```http
HTTP 200

[ 2건 ] ["A가 B 이름으로 만들려던 계획","A의 비밀 계획"]
```

#### 50. A 로그아웃 — ✅ 예상대로

```http
POST /api/auth/logout
Cookie: pds_sid=cxm3x…생략   ← A의 세션
```
```http
HTTP 204
Set-Cookie: pds_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0
```

#### 51. [거절] 로그아웃 뒤: 똑같은 쿠키 값으로 GET /api/plans — ✅ 예상대로

```http
GET /api/plans
Cookie: pds_sid=cxm3x…생략
```
```http
HTTP 401
Set-Cookie: pds_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0

{"error":"로그인이 필요합니다. (로그아웃했거나 기간이 지났습니다)"}
```

#### 52. [거절] 로그아웃 뒤: 똑같은 쿠키 값으로 계획 만들기 — ✅ 예상대로

```http
POST /api/plans
Cookie: pds_sid=cxm3x…생략

{"start_date":"2026-11-06","end_date":"2026-11-10","priority":1,"success_criteria":"확인용","estimate_minutes":60,"title":"로그아웃 뒤"}
```
```http
HTTP 401
Set-Cookie: pds_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0

{"error":"로그인이 필요합니다. (로그아웃했거나 기간이 지났습니다)"}
```

### ㅅ. [확인 5] 비밀번호를 바꾸면 이전에 발급한 값이 더는 통하지 않음 (같은 주소·같은 방식)

#### 53. [성공] 바꾸기 전: A가 가입할 때 받은 쿠키로 GET /api/plans — ✅ 예상대로

```http
GET /api/plans
Cookie: pds_sid=hNkG5…생략
```
```http
HTTP 200

[ 2건 ] ["A가 B 이름으로 만들려던 계획","A의 비밀 계획"]
```

#### 54. A 비밀번호 바꾸기 (이 쿠키로 요청) — ✅ 예상대로

```http
POST /api/auth/password
Cookie: pds_sid=hNkG5…생략

{"current_password":"Pw-Sa…생략","new_password":"Nw-lP…생략"}
```
```http
HTTP 200
Set-Cookie: pds_sid=94Vkq…생략; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800

{"user":{"id":"83e9bf50-625e-4cfc-bb17-e0707ec464e8","email":"verify-a-155d93@example.com"}}
```

#### 55. [거절] 바꾼 뒤: 똑같은 예전 쿠키 값으로 GET /api/plans — ✅ 예상대로

```http
GET /api/plans
Cookie: pds_sid=hNkG5…생략
```
```http
HTTP 401
Set-Cookie: pds_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0

{"error":"로그인이 필요합니다. (로그아웃했거나 기간이 지났습니다)"}
```

#### 56. [성공] 바꿀 때 새로 받은 쿠키로 GET /api/plans — ✅ 예상대로

```http
GET /api/plans
Cookie: pds_sid=94Vkq…생략   ← A의 세션
```
```http
HTTP 200

[ 2건 ] ["A가 B 이름으로 만들려던 계획","A의 비밀 계획"]
```

#### 57. [거절] 예전 비밀번호로 로그인 — ✅ 예상대로

```http
POST /api/auth/login
Cookie: (보내지 않음)

{"email":"verify-a-155d93@example.com","password":"Pw-Sa…생략"}
```
```http
HTTP 401

{"error":"이메일 또는 비밀번호가 맞지 않습니다."}
```

### ㅇ. 비밀번호 저장값

두 계정을 **같은 비밀번호**로 가입한 직후 DB 를 직접 읽은 값입니다(가리지 않고 그대로 옮김). 저장값은 비밀번호를 되돌릴 수 없게 바꾼 결과라 원문이 아닙니다.
형식: `scrypt$N$r$p$소금(16바이트, base64)$결과(32바이트, base64)`

```sql
SELECT email, password_hash FROM users ORDER BY email;   -- B 가입 직후
```
```text
verify-a-155d93@example.com | scrypt$32768$8$1$ajD9Utodb8/8ZOIF1dzW8Q==$/gVT/I2DcAZolGARHrQzN7S9wNxNj350AGQDmUTBdlY=
verify-b-155d93@example.com | scrypt$32768$8$1$QIGCb6HfIlBWTMSKlNSW+Q==$z18xAhXmEO8COvI0cFmkD1AYmIXHrp7y+h/bd1lbNU4=
```
- 같은 비밀번호인데 두 저장값이 서로 다른가? → **다름 ✅** (소금이 다름: `ajD9Utodb8/8ZOIF1dzW8Q==` vs `QIGCb6HfIlBWTMSKlNSW+Q==`)
- 입력한 비밀번호 글자가 저장값 안에 들어 있나? → **아니오 ✅**
- 지금 남은 세션 행 2개, 그중 쿠키 원문과 같은 값이 저장된 행 **0개** (SHA-256 값만 저장)

### ㅈ. 계정 지우기 (시험 계정 정리 겸 확인)

#### 58. A 계정 지우기 (틀린 비밀번호) → 거절 — ✅ 예상대로

```http
DELETE /api/auth/account
Cookie: pds_sid=94Vkq…생략   ← A의 세션

{"password":"wrong…생략"}
```
```http
HTTP 400

{"error":"지금 비밀번호가 맞지 않습니다."}
```

#### 59. A 계정 지우기 — ✅ 예상대로

```http
DELETE /api/auth/account
Cookie: pds_sid=94Vkq…생략   ← A의 세션

{"password":"Nw-lP…생략"}
```
```http
HTTP 204
Set-Cookie: pds_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0
```

#### 60. [거절] 지운 뒤 같은 쿠키로 계획 목록 — ✅ 예상대로

```http
GET /api/plans
Cookie: pds_sid=94Vkq…생략
```
```http
HTTP 401
Set-Cookie: pds_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0

{"error":"로그인이 필요합니다. (로그아웃했거나 기간이 지났습니다)"}
```

#### 61. [거절] 지운 계정으로 로그인 — ✅ 예상대로

```http
POST /api/auth/login
Cookie: (보내지 않음)

{"email":"verify-a-155d93@example.com","password":"Nw-lP…생략"}
```
```http
HTTP 401

{"error":"이메일 또는 비밀번호가 맞지 않습니다."}
```

#### 62. B의 계획은 그대로 — ✅ 예상대로

```http
GET /api/plans
Cookie: pds_sid=J0btl…생략   ← B의 세션
```
```http
HTTP 200

[ 1건 ] ["B의 비밀 계획"]
```

#### 63. B 계정 지우기 (정리) — ✅ 예상대로

```http
DELETE /api/auth/account
Cookie: pds_sid=J0btl…생략   ← B의 세션

{"password":"Pw-Sa…생략"}
```
```http
HTTP 204
Set-Cookie: pds_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0
```

### ㅊ. 서버 로그

- 이번 실행 동안 서버가 찍은 로그 0줄 가운데 비밀번호·쿠키 원문이 들어 있는 줄: **0줄**
- 서버는 요청 본문을 로그로 찍지 않습니다. 찍는 것은 500 오류의 코드와 첫 줄뿐입니다 (server/app.js 마지막 오류 처리기).

**결과: 63개 요청이 모두 예상한 상태 코드로 응답했고, 거절 앞뒤 건수도 같았습니다.**
