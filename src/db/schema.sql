-- 합주표 스키마 (Postgres / Neon)
-- 여러 번 실행해도 안전하게 IF NOT EXISTS 로 작성했어요.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 동아리원. 로그인 없이 이름으로 구분해요.
CREATE TABLE IF NOT EXISTS members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE CHECK (char_length(btrim(name)) BETWEEN 1 AND 30),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 합주 팀
CREATE TABLE IF NOT EXISTS teams (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id   uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, member_id)
);

-- 팀이 속한 동아리 (akui 악의꽃 / makmu 막무간애 / moyeo 모여락). 팀 목록은 내 동아리 팀만 보여줘요.
ALTER TABLE teams ADD COLUMN IF NOT EXISTS club text CHECK (club IN ('akui', 'makmu', 'moyeo'));

-- 동아리를 모르는 예전 팀은 팀원 이름("악의꽃 40G 김민재")에서 가장 많은 동아리로 채워요.
UPDATE teams t
   SET club = (
     SELECT CASE substring(m.name from '^(악의꽃|막무간애|모여락) ')
              WHEN '악의꽃' THEN 'akui' WHEN '막무간애' THEN 'makmu' WHEN '모여락' THEN 'moyeo' END
       FROM team_members tm JOIN members m ON m.id = tm.member_id
      WHERE tm.team_id = t.id AND m.name ~ '^(악의꽃|막무간애|모여락) '
      GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 1)
 WHERE t.club IS NULL;

-- 팀 이름 중복은 같은 동아리 안에서만 막아요 (악의꽃 "A팀"과 막무간애 "A팀"은 같이 있을 수 있어요).
ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS teams_club_name_key ON teams (club, name);

-- 사람별 · 날짜별 가능 시간.
-- 팀마다 따로 입력하지 않고, 한 사람이 한 번 칠하면 모든 팀 화면에 쓰여요.
-- slots: 한국 시간 기준 30분 칸 번호 (0 = 00:00, 18 = 09:00, 47 = 23:30)
CREATE TABLE IF NOT EXISTS availability (
  member_id  uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  day        date NOT NULL,
  slots      smallint[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, day)
);

-- 수업 시간표. 매주 반복되고, 이 시간은 가능 시간에서 자동으로 빠져요.
-- weekday: 0 = 월 ... 6 = 일 / start_min, end_min: 자정부터 분 (12:00 = 720)
CREATE TABLE IF NOT EXISTS member_classes (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  weekday   smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_min smallint NOT NULL CHECK (start_min BETWEEN 0 AND 1439),
  end_min   smallint NOT NULL CHECK (end_min BETWEEN 1 AND 1440),
  title     text CHECK (char_length(title) <= 60),
  CHECK (end_min > start_min)
);

CREATE INDEX IF NOT EXISTS member_classes_member_idx ON member_classes (member_id);

-- 확정된 합주. 이 한 줄이 모든 화면(팀 히트맵, 내 시간, 개인 캘린더 구독)의 기준이에요.
CREATE TABLE IF NOT EXISTS rehearsals (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  start_at   timestamptz NOT NULL,
  end_at     timestamptz NOT NULL,
  memo       text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at)
);

CREATE INDEX IF NOT EXISTS rehearsals_time_idx ON rehearsals (start_at, end_at);

-- 합주 참여자. 시간을 같이 저장해서 "한 사람이 겹치는 두 합주에 들어가는 것"을 DB가 막아요.
CREATE TABLE IF NOT EXISTS rehearsal_participants (
  rehearsal_id uuid NOT NULL REFERENCES rehearsals(id) ON DELETE CASCADE,
  member_id    uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  start_at     timestamptz NOT NULL,
  end_at       timestamptz NOT NULL,
  PRIMARY KEY (rehearsal_id, member_id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'no_double_booking') THEN
    ALTER TABLE rehearsal_participants
      ADD CONSTRAINT no_double_booking
      EXCLUDE USING gist (member_id WITH =, tstzrange(start_at, end_at) WITH &&);
  END IF;
END $$;

-- 합주 시간을 바꾸면 참여자 시간도 같이 바뀌어요.
-- 바뀐 시간이 누군가의 다른 합주와 겹치면 위 제약 때문에 변경 전체가 취소돼요.
CREATE OR REPLACE FUNCTION sync_participant_times() RETURNS trigger AS $$
BEGIN
  UPDATE rehearsal_participants
     SET start_at = NEW.start_at, end_at = NEW.end_at
   WHERE rehearsal_id = NEW.id;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_participant_times ON rehearsals;
CREATE TRIGGER trg_sync_participant_times
  AFTER UPDATE OF start_at, end_at ON rehearsals
  FOR EACH ROW EXECUTE FUNCTION sync_participant_times();

-- ───────── 뜨락(동아리 연습실) 대여 ─────────
-- 합주 일정 기능과는 별개예요. 악의꽃 · 막무간애 · 모여락 세 동아리가 같이 쓰는 방 하나라서
-- 어느 동아리든 시간이 겹치는 예약은 DB가 거부해요.
CREATE TABLE IF NOT EXISTS ddrak_bookings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club       text NOT NULL CHECK (club IN ('akui', 'makmu', 'moyeo')),
  start_at   timestamptz NOT NULL,
  end_at     timestamptz NOT NULL,
  title      text CHECK (char_length(title) <= 60),
  booked_by  text CHECK (char_length(booked_by) <= 30),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ddrak_no_overlap') THEN
    ALTER TABLE ddrak_bookings
      ADD CONSTRAINT ddrak_no_overlap
      EXCLUDE USING gist (tstzrange(start_at, end_at) WITH &&);
  END IF;
END $$;
