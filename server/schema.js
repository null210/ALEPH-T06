// 데이터베이스 표 정의 (contracts/pds-schema-v2.json 과 같은 내용).
// Vercel 함수 묶음에 확실히 들어가도록 .sql 파일 대신 JS 문자열로 둔다.
export const SCHEMA_SQL = `
-- PDS 플래너 데이터베이스 (contracts/pds-schema-v2.json 과 같은 내용)
-- 날짜 규칙: 날짜(date)는 'YYYY-MM-DD' 문자열, 시각(timestamptz)은 ISO 8601 UTC 로 주고받는다.
--           '오늘'은 항상 Asia/Seoul 기준으로 계산한다. 시간 단위는 모두 '분'(정수)이다.

CREATE TABLE IF NOT EXISTS plans (
  id                 uuid PRIMARY KEY,
  title              text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  start_date         date NOT NULL,
  end_date           date NOT NULL,
  priority           smallint NOT NULL CHECK (priority BETWEEN 1 AND 3),
  success_criteria   text NOT NULL CHECK (length(success_criteria) BETWEEN 1 AND 2000),
  estimate_minutes   integer NOT NULL CHECK (estimate_minutes >= 0),
  carried_review_id  uuid,
  version            integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

-- 계획을 고칠 때마다 고치기 전 내용을 한 행으로 남긴다 (덮어쓰지 않음)
CREATE TABLE IF NOT EXISTS plan_versions (
  id                 uuid PRIMARY KEY,
  plan_id            uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  version            integer NOT NULL,
  title              text NOT NULL,
  start_date         date NOT NULL,
  end_date           date NOT NULL,
  priority           smallint NOT NULL,
  success_criteria   text NOT NULL,
  estimate_minutes   integer NOT NULL,
  saved_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, version)
);

CREATE TABLE IF NOT EXISTS tasks (
  id                 uuid PRIMARY KEY,
  plan_id            uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  title              text NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  status             text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'done')),
  due_date           date,
  priority           smallint CHECK (priority BETWEEN 1 AND 3),
  tags               jsonb NOT NULL DEFAULT '[]'::jsonb,
  estimate_minutes   integer CHECK (estimate_minutes >= 0),
  completed_at       timestamptz,
  deleted_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasks_plan_idx ON tasks (plan_id);

-- 완료 기록. 되돌리지 않은 완료는 할 일당 한 건만 허용 (연타해도 한 건)
CREATE TABLE IF NOT EXISTS task_completions (
  id                 uuid PRIMARY KEY,
  task_id            uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  completed_at       timestamptz NOT NULL DEFAULT now(),
  reopened_at        timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS task_completions_one_open
  ON task_completions (task_id) WHERE reopened_at IS NULL;

-- 실행 기록. 계획·할 일의 예상값과 별도로 저장해 원래 값을 덮어쓰지 않는다
CREATE TABLE IF NOT EXISTS work_logs (
  id                 uuid PRIMARY KEY,
  task_id            uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  started_at         timestamptz NOT NULL,
  ended_at           timestamptz NOT NULL,
  actual_minutes     integer NOT NULL CHECK (actual_minutes >= 0),
  blocked_reason     text,
  note               text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_at >= started_at)
);
CREATE INDEX IF NOT EXISTS work_logs_task_idx ON work_logs (task_id);

-- 돌아보기. 저장 시점의 집계와 다음 계획으로 넘길 고칠 점 한 건
CREATE TABLE IF NOT EXISTS reviews (
  id                 uuid PRIMARY KEY,
  plan_id            uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  improvement        text NOT NULL CHECK (length(improvement) BETWEEN 1 AND 1000),
  summary            jsonb NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- 다음 계획이 어느 돌아보기의 고칠 점을 이어받았는지 (plans → reviews)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plans_carried_review_fk') THEN
    ALTER TABLE plans ADD CONSTRAINT plans_carried_review_fk
      FOREIGN KEY (carried_review_id) REFERENCES reviews(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ===== 7번: 가입·로그인 =====
-- 비밀번호 원문은 저장하지 않는다. password_hash 는 'scrypt$N$r$p$소금$결과' 형식
CREATE TABLE IF NOT EXISTS users (
  id                 uuid PRIMARY KEY,
  email              text NOT NULL UNIQUE CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 254),
  password_hash      text NOT NULL CHECK (password_hash LIKE 'scrypt$%'),
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- 로그인 세션. 쿠키 값(토큰) 자체가 아니라 SHA-256 값만 둔다. 로그아웃하면 행을 지운다
CREATE TABLE IF NOT EXISTS sessions (
  token_hash         text PRIMARY KEY,
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

-- 로그인 실패 기록 (같은 이메일로 너무 많이 틀리면 잠시 막기)
CREATE TABLE IF NOT EXISTS login_failures (
  id                 uuid PRIMARY KEY,
  email              text NOT NULL,
  at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_failures_email_idx ON login_failures (email, at);

-- 계획의 주인. 할 일·실행 기록·돌아보기는 계획을 거쳐 주인이 정해진다.
-- 6번 때 넣은 자료는 주인이 비어 있어 아무에게도 보이지 않는다 (OWNER_EMAIL 로 가입하면 가져감)
ALTER TABLE plans ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS plans_user_idx ON plans (user_id);

-- ===== 7번: 5일 기록 =====
-- 1일차 전에 한 번만 정하고 바꾸지 않는 것: 질문·지표·단위·계산 규칙·처음 계획 규칙 (한 사람에 하나)
CREATE TABLE IF NOT EXISTS experiments (
  id                 uuid PRIMARY KEY,
  user_id            uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  question           text NOT NULL CHECK (length(question) BETWEEN 1 AND 300),
  metric             text NOT NULL CHECK (length(metric) BETWEEN 1 AND 100),
  unit               text NOT NULL CHECK (length(unit) BETWEEN 1 AND 20),
  calc_rule          text NOT NULL CHECK (length(calc_rule) BETWEEN 1 AND 500),
  plan_rule          text NOT NULL CHECK (length(plan_rule) BETWEEN 1 AND 300),
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- 하루 기록. 날짜는 서버가 정한 '오늘(Asia/Seoul)'만 들어간다. 한 날짜에 한 행, 최대 5일
CREATE TABLE IF NOT EXISTS daily_entries (
  id                 uuid PRIMARY KEY,
  experiment_id      uuid NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  entry_date         date NOT NULL,
  day_no             smallint NOT NULL CHECK (day_no BETWEEN 1 AND 5),
  value              double precision,
  note               text,
  phase              text NOT NULL CHECK (phase IN ('before', 'after')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (experiment_id, entry_date),
  UNIQUE (experiment_id, day_no)
);

-- 계획 규칙 변경. 한 번만, 2일차 기록 뒤·3일차 기록 앞에만 만들 수 있다. 1·2일차 기록을 가리킨다
CREATE TABLE IF NOT EXISTS rule_changes (
  id                 uuid PRIMARY KEY,
  experiment_id      uuid NOT NULL UNIQUE REFERENCES experiments(id) ON DELETE CASCADE,
  day1_entry_id      uuid NOT NULL REFERENCES daily_entries(id) ON DELETE CASCADE,
  day2_entry_id      uuid NOT NULL REFERENCES daily_entries(id) ON DELETE CASCADE,
  before_rule        text NOT NULL,
  after_rule         text NOT NULL CHECK (length(after_rule) BETWEEN 1 AND 300),
  reason             text NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  changed_at         timestamptz NOT NULL DEFAULT now()
);

-- Supabase 는 public 스키마의 표를 자체 REST API(anon 키)로도 열어 둔다.
-- 정책 없이 행 수준 보안(RLS)을 켜서 그 길을 막는다. 이 서버는 표 주인이라 영향이 없다.
ALTER TABLE plans            ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_versions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews          ENABLE ROW LEVEL SECURITY;

-- GitHub·Google 로그인 연결. 제공자 쪽 사용자 번호 하나는 우리 계정 하나에만 붙는다.
-- GitHub·Google 로만 가입한 계정은 비밀번호가 없다(password_hash NULL). 비밀번호 로그인은 늘 실패한다.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
CREATE TABLE IF NOT EXISTS oauth_accounts (
  provider           text NOT NULL CHECK (provider IN ('github', 'google')),
  provider_user_id   text NOT NULL,
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email              text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_user_id)
);
CREATE INDEX IF NOT EXISTS oauth_accounts_user_idx ON oauth_accounts (user_id);

-- 7번에서 만든 표도 같은 이유로 RLS 를 켠다. 특히 users(비밀번호 저장값)와 sessions 가 REST API 로 새면 안 된다.
ALTER TABLE users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_failures   ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_entries    ENABLE ROW LEVEL SECURITY;
ALTER TABLE rule_changes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_accounts   ENABLE ROW LEVEL SECURITY;
`;
