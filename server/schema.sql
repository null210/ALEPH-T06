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
