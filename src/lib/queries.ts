import type { Sql } from "./db";
import { slotToIso, type Day } from "./time";
import type { Busy, ClassBlock, Conflict, DaySlots, Member, Rehearsal, Team, TeamGrid } from "./types";

// 배열 인자는 드라이버마다 직렬화가 달라서 JSON 문자열로 넘기고 SQL에서 풀어요.
const json = (v: unknown) => JSON.stringify(v);
const iso = (v: unknown) => new Date(v as string).toISOString();

/* ───────── 멤버 ───────── */

export async function listMembers(sql: Sql): Promise<Member[]> {
  return sql`SELECT id, name FROM members ORDER BY name`;
}

/** 같은 이름이 있으면 그 사람을 그대로 돌려줘요 */
export async function upsertMember(sql: Sql, name: string): Promise<Member> {
  const [row] = await sql`
    INSERT INTO members (name) VALUES (${name})
    ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
    RETURNING id, name`;
  return row;
}

export async function getMember(sql: Sql, id: string): Promise<Member | null> {
  const [row] = await sql`SELECT id, name FROM members WHERE id = ${id}::uuid`;
  return row ?? null;
}

/* ───────── 가능 시간 ───────── */

export async function getAvailability(
  sql: Sql,
  memberIds: string[],
  from: Day,
  to: Day,
): Promise<Record<string, DaySlots>> {
  const rows = await sql`
    SELECT member_id, day::text AS day, slots
      FROM availability
     WHERE member_id IN (SELECT x::uuid FROM jsonb_array_elements_text(${json(memberIds)}::jsonb) x)
       AND day >= ${from}::date AND day < ${to}::date`;
  const out: Record<string, DaySlots> = {};
  for (const id of memberIds) out[id] = {};
  for (const r of rows) {
    out[r.member_id] ??= {};
    out[r.member_id][r.day] = (r.slots as number[]).map(Number);
  }
  return out;
}

/** 넘긴 날짜들만 통째로 덮어써요 (빈 배열이면 그날은 전부 불가) */
export async function saveAvailability(sql: Sql, memberId: string, days: DaySlots): Promise<void> {
  if (Object.keys(days).length === 0) return;
  await sql`
    INSERT INTO availability (member_id, day, slots, updated_at)
    SELECT ${memberId}::uuid,
           d.key::date,
           COALESCE(ARRAY(SELECT DISTINCT s::smallint FROM jsonb_array_elements_text(d.value) s ORDER BY 1), '{}'),
           now()
      FROM jsonb_each(${json(days)}::jsonb) d
    ON CONFLICT (member_id, day)
    DO UPDATE SET slots = EXCLUDED.slots, updated_at = now()`;
}

/* ───────── 수업 시간표 ───────── */

export async function listClasses(sql: Sql, memberIds: string[]): Promise<Record<string, ClassBlock[]>> {
  const rows = await sql`
    SELECT member_id, weekday, start_min, end_min, COALESCE(title, '') AS title
      FROM member_classes
     WHERE member_id IN (SELECT x::uuid FROM jsonb_array_elements_text(${json(memberIds)}::jsonb) x)
     ORDER BY weekday, start_min`;
  const out: Record<string, ClassBlock[]> = {};
  for (const id of memberIds) out[id] = [];
  for (const r of rows) {
    (out[r.member_id] ??= []).push({
      weekday: Number(r.weekday),
      startMin: Number(r.start_min),
      endMin: Number(r.end_min),
      title: r.title,
    });
  }
  return out;
}

/** 그 사람의 수업 목록을 통째로 바꿔요 */
export async function replaceClasses(sql: Sql, memberId: string, classes: ClassBlock[]): Promise<void> {
  await sql`
    WITH del AS (DELETE FROM member_classes WHERE member_id = ${memberId}::uuid)
    INSERT INTO member_classes (member_id, weekday, start_min, end_min, title)
    SELECT ${memberId}::uuid, (c->>'weekday')::smallint, (c->>'startMin')::smallint, (c->>'endMin')::smallint,
           NULLIF(c->>'title', '')
      FROM jsonb_array_elements(${json(classes)}::jsonb) c`;
}

/* ───────── 팀 ───────── */

function toTeam(r: { id: string; name: string; members: Member[] | string }): Team {
  const members = typeof r.members === "string" ? JSON.parse(r.members) : r.members;
  return { id: r.id, name: r.name, members };
}

export async function listTeams(sql: Sql): Promise<Team[]> {
  const rows = await sql`
    SELECT t.id, t.name,
           COALESCE(json_agg(json_build_object('id', m.id, 'name', m.name) ORDER BY m.name)
                    FILTER (WHERE m.id IS NOT NULL), '[]') AS members
      FROM teams t
      LEFT JOIN team_members tm ON tm.team_id = t.id
      LEFT JOIN members m ON m.id = tm.member_id
     GROUP BY t.id
     ORDER BY t.name`;
  return rows.map(toTeam);
}

export async function getTeam(sql: Sql, id: string): Promise<Team | null> {
  const rows = await sql`
    SELECT t.id, t.name,
           COALESCE(json_agg(json_build_object('id', m.id, 'name', m.name) ORDER BY m.name)
                    FILTER (WHERE m.id IS NOT NULL), '[]') AS members
      FROM teams t
      LEFT JOIN team_members tm ON tm.team_id = t.id
      LEFT JOIN members m ON m.id = tm.member_id
     WHERE t.id = ${id}::uuid
     GROUP BY t.id`;
  return rows[0] ? toTeam(rows[0]) : null;
}

export async function createTeam(sql: Sql, name: string, memberIds: string[]): Promise<string> {
  const [row] = await sql`
    WITH t AS (INSERT INTO teams (name) VALUES (${name}) RETURNING id),
         ins AS (
           INSERT INTO team_members (team_id, member_id)
           SELECT t.id, x::uuid FROM t, jsonb_array_elements_text(${json(memberIds)}::jsonb) x
         )
    SELECT id FROM t`;
  return row.id;
}

export async function renameTeam(sql: Sql, id: string, name: string): Promise<void> {
  await sql`UPDATE teams SET name = ${name} WHERE id = ${id}::uuid`;
}

export async function deleteTeam(sql: Sql, id: string): Promise<void> {
  await sql`DELETE FROM teams WHERE id = ${id}::uuid`;
}

/**
 * 팀 멤버를 바꾸고, 아직 시작 안 한 이 팀 합주의 참여자도 같이 맞춰요.
 * 새로 들어온 사람이 그 시간에 다른 합주가 있으면 23P01 에러로 전체가 취소돼요.
 */
export async function setTeamMembers(sql: Sql, teamId: string, memberIds: string[]): Promise<void> {
  await sql`
    WITH ids AS (
           SELECT x::uuid AS member_id FROM jsonb_array_elements_text(${json(memberIds)}::jsonb) x
         ),
         del_tm AS (
           DELETE FROM team_members
            WHERE team_id = ${teamId}::uuid AND member_id NOT IN (SELECT member_id FROM ids)
         ),
         ins_tm AS (
           INSERT INTO team_members (team_id, member_id)
           SELECT ${teamId}::uuid, member_id FROM ids
           ON CONFLICT DO NOTHING
         ),
         upcoming AS (
           SELECT id, start_at, end_at FROM rehearsals
            WHERE team_id = ${teamId}::uuid AND start_at > now()
         ),
         del_p AS (
           DELETE FROM rehearsal_participants p
            USING upcoming u
            WHERE p.rehearsal_id = u.id AND p.member_id NOT IN (SELECT member_id FROM ids)
         )
    INSERT INTO rehearsal_participants (rehearsal_id, member_id, start_at, end_at)
    SELECT u.id, ids.member_id, u.start_at, u.end_at FROM upcoming u CROSS JOIN ids
    ON CONFLICT (rehearsal_id, member_id) DO NOTHING`;
}

/* ───────── 합주 ───────── */

type RehearsalRow = {
  id: string;
  team_id: string;
  team_name: string;
  start_at: string;
  end_at: string;
  memo: string | null;
  participants: Member[] | string;
};

function toRehearsal(r: RehearsalRow): Rehearsal {
  return {
    id: r.id,
    teamId: r.team_id,
    teamName: r.team_name,
    startAt: iso(r.start_at),
    endAt: iso(r.end_at),
    memo: r.memo,
    participants: typeof r.participants === "string" ? JSON.parse(r.participants) : r.participants,
  };
}

/** 기간 안의 합주. memberId를 주면 그 사람이 참여하는 것만, teamId를 주면 그 팀 것만 */
export async function listRehearsals(
  sql: Sql,
  opts: { from: Day; to: Day; memberId?: string | null; teamId?: string | null },
): Promise<Rehearsal[]> {
  const fromTs = slotToIso(opts.from, 0);
  const toTs = slotToIso(opts.to, 0);
  const rows = await sql`
    SELECT r.id, r.team_id, t.name AS team_name, r.start_at, r.end_at, r.memo,
           COALESCE(json_agg(json_build_object('id', m.id, 'name', m.name) ORDER BY m.name)
                    FILTER (WHERE m.id IS NOT NULL), '[]') AS participants
      FROM rehearsals r
      JOIN teams t ON t.id = r.team_id
      LEFT JOIN rehearsal_participants p ON p.rehearsal_id = r.id
      LEFT JOIN members m ON m.id = p.member_id
     WHERE r.start_at < ${toTs}::timestamptz
       AND r.end_at > ${fromTs}::timestamptz
       AND (${opts.teamId ?? null}::uuid IS NULL OR r.team_id = ${opts.teamId ?? null}::uuid)
       AND (${opts.memberId ?? null}::uuid IS NULL OR EXISTS (
             SELECT 1 FROM rehearsal_participants pp
              WHERE pp.rehearsal_id = r.id AND pp.member_id = ${opts.memberId ?? null}::uuid))
     GROUP BY r.id, t.name
     ORDER BY r.start_at`;
  return rows.map(toRehearsal);
}

export async function getRehearsal(sql: Sql, id: string): Promise<Rehearsal | null> {
  const rows = await sql`
    SELECT r.id, r.team_id, t.name AS team_name, r.start_at, r.end_at, r.memo,
           COALESCE(json_agg(json_build_object('id', m.id, 'name', m.name) ORDER BY m.name)
                    FILTER (WHERE m.id IS NOT NULL), '[]') AS participants
      FROM rehearsals r
      JOIN teams t ON t.id = r.team_id
      LEFT JOIN rehearsal_participants p ON p.rehearsal_id = r.id
      LEFT JOIN members m ON m.id = p.member_id
     WHERE r.id = ${id}::uuid
     GROUP BY r.id, t.name`;
  return rows[0] ? toRehearsal(rows[0]) : null;
}

/** 합주와 참여자(현재 팀원 전원)를 한 문장으로 넣어요. 겹치면 23P01 에러. */
export async function createRehearsal(
  sql: Sql,
  input: { teamId: string; startAt: string; endAt: string; memo?: string | null; createdBy?: string | null },
): Promise<string> {
  const [row] = await sql`
    WITH r AS (
           INSERT INTO rehearsals (team_id, start_at, end_at, memo, created_by)
           VALUES (${input.teamId}::uuid, ${input.startAt}::timestamptz, ${input.endAt}::timestamptz,
                   ${input.memo ?? null}, ${input.createdBy ?? null})
           RETURNING id, team_id, start_at, end_at
         ),
         p AS (
           INSERT INTO rehearsal_participants (rehearsal_id, member_id, start_at, end_at)
           SELECT r.id, tm.member_id, r.start_at, r.end_at
             FROM r JOIN team_members tm ON tm.team_id = r.team_id
         )
    SELECT id FROM r`;
  return row.id;
}

/** 시간 변경. 트리거가 참여자 시간을 같이 옮기고, 겹치면 23P01 에러로 전체가 취소돼요. */
export async function updateRehearsal(
  sql: Sql,
  id: string,
  input: { startAt?: string; endAt?: string; memo?: string | null },
): Promise<boolean> {
  const rows = await sql`
    UPDATE rehearsals
       SET start_at   = COALESCE(${input.startAt ?? null}::timestamptz, start_at),
           end_at     = COALESCE(${input.endAt ?? null}::timestamptz, end_at),
           memo       = CASE WHEN ${input.memo === undefined}::boolean THEN memo ELSE ${input.memo ?? null}::text END,
           updated_at = now()
     WHERE id = ${id}::uuid
     RETURNING id`;
  return rows.length > 0;
}

export async function deleteRehearsal(sql: Sql, id: string): Promise<boolean> {
  const rows = await sql`DELETE FROM rehearsals WHERE id = ${id}::uuid RETURNING id`;
  return rows.length > 0;
}

/** 이 사람들이 그 시간에 이미 들어가 있는 다른 합주 (에러 메시지용) */
export async function findConflicts(
  sql: Sql,
  memberIds: string[],
  startAt: string,
  endAt: string,
  excludeRehearsalId: string | null = null,
): Promise<Conflict[]> {
  const rows = await sql`
    SELECT m.name AS member_name, t.name AS team_name, r.start_at, r.end_at
      FROM rehearsal_participants p
      JOIN members m ON m.id = p.member_id
      JOIN rehearsals r ON r.id = p.rehearsal_id
      JOIN teams t ON t.id = r.team_id
     WHERE p.member_id IN (SELECT x::uuid FROM jsonb_array_elements_text(${json(memberIds)}::jsonb) x)
       AND p.start_at < ${endAt}::timestamptz
       AND p.end_at > ${startAt}::timestamptz
       AND (${excludeRehearsalId}::uuid IS NULL OR r.id <> ${excludeRehearsalId}::uuid)
     ORDER BY r.start_at, m.name`;
  return rows.map((r) => ({
    memberName: r.member_name,
    teamName: r.team_name,
    startAt: iso(r.start_at),
    endAt: iso(r.end_at),
  }));
}

/* ───────── 팀 히트맵 데이터 ───────── */

export async function getTeamGrid(sql: Sql, teamId: string, from: Day, to: Day): Promise<TeamGrid | null> {
  const team = await getTeam(sql, teamId);
  if (!team) return null;
  const ids = team.members.map((m) => m.id);
  const fromTs = slotToIso(from, 0);
  const toTs = slotToIso(to, 0);

  const [availability, classes, busyRows, rehearsals] = await Promise.all([
    getAvailability(sql, ids, from, to),
    listClasses(sql, ids),
    sql`
      SELECT p.member_id, r.id AS rehearsal_id, r.team_id, t.name AS team_name, r.start_at, r.end_at
        FROM rehearsal_participants p
        JOIN rehearsals r ON r.id = p.rehearsal_id
        JOIN teams t ON t.id = r.team_id
       WHERE p.member_id IN (SELECT x::uuid FROM jsonb_array_elements_text(${json(ids)}::jsonb) x)
         AND p.start_at < ${toTs}::timestamptz
         AND p.end_at > ${fromTs}::timestamptz
         AND r.team_id <> ${teamId}::uuid`,
    listRehearsals(sql, { from, to, teamId }),
  ]);

  const busy: Busy[] = busyRows.map((r) => ({
    memberId: r.member_id,
    rehearsalId: r.rehearsal_id,
    teamId: r.team_id,
    teamName: r.team_name,
    startAt: iso(r.start_at),
    endAt: iso(r.end_at),
  }));

  return { team, availability, classes, busy, rehearsals };
}
