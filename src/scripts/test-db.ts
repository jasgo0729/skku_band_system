// 실제 Neon 없이 PGlite(메모리 Postgres)로 스키마와 쿼리를 검증해요.
// 실행: npm run test:db
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import type { Sql } from "../lib/db";
import { pgCode } from "../lib/db";
import * as q from "../lib/queries";
import { slotToIso } from "../lib/time";

async function main() {
  const db = await PGlite.create({ extensions: { btree_gist } });
  const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
  await db.exec(schema);
  await db.exec(schema); // 두 번 실행해도 안전한지
  const sql: Sql = async (s, ...v) => (await db.sql(s, ...v)).rows as never[];

  let passed = 0;
  const ok = (name: string) => {
    passed++;
    console.log("  ✓", name);
  };
  const expectCode = async (code: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      assert.equal(pgCode(e), code);
      return;
    }
    assert.fail(`${code} 에러가 나야 해요`);
  };

  // 멤버
  const kim = await q.upsertMember(sql, "김드럼");
  const kim2 = await q.upsertMember(sql, "김드럼");
  assert.equal(kim.id, kim2.id);
  const lee = await q.upsertMember(sql, "이베이스");
  const park = await q.upsertMember(sql, "박기타");
  const choi = await q.upsertMember(sql, "최보컬");
  assert.equal((await q.listMembers(sql)).length, 4);
  ok("같은 이름은 같은 사람으로 처리");

  // 팀: 김드럼은 A, B 두 팀 소속
  const teamA = await q.createTeam(sql, "A팀", [kim.id, lee.id]);
  const teamB = await q.createTeam(sql, "B팀", [kim.id, park.id]);
  const empty = await q.createTeam(sql, "빈팀", []);
  const teams = await q.listTeams(sql);
  assert.equal(teams.length, 3);
  assert.deepEqual(teams.find((t) => t.id === empty)!.members, []);
  assert.deepEqual((await q.getTeam(sql, teamA))!.members.map((m) => m.name).sort(), ["김드럼", "이베이스"]);
  ok("팀 생성과 멤버 조회");

  // 가능 시간
  await q.saveAvailability(sql, kim.id, { "2030-03-01": [38, 39, 40, 40], "2030-03-02": [20] });
  await q.saveAvailability(sql, kim.id, { "2030-03-02": [] });
  const av = await q.getAvailability(sql, [kim.id, lee.id], "2030-03-01", "2030-03-08");
  assert.deepEqual(av[kim.id]["2030-03-01"], [38, 39, 40]);
  assert.deepEqual(av[kim.id]["2030-03-02"], []);
  assert.deepEqual(av[lee.id], {});
  ok("가능 시간 저장 · 덮어쓰기 · 중복 제거");

  // 합주: 2030-03-01 (금) 한국시간
  const t = (idx: number) => slotToIso("2030-03-01", idx);
  const ra = await q.createRehearsal(sql, { teamId: teamA, startAt: t(38), endAt: t(42), createdBy: "김드럼" }); // 19–21
  const rA = (await q.getRehearsal(sql, ra))!;
  assert.equal(rA.participants.length, 2);
  ok("합주 확정 시 팀원 전원이 참여자로 들어감");

  await expectCode("23P01", () => q.createRehearsal(sql, { teamId: teamB, startAt: t(40), endAt: t(44) })); // 20–22
  const conflicts = await q.findConflicts(sql, [kim.id, park.id], t(40), t(44));
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].memberName, "김드럼");
  assert.equal(conflicts[0].teamName, "A팀");
  assert.equal((await q.listRehearsals(sql, { from: "2030-03-01", to: "2030-03-02" })).length, 1);
  ok("겹치는 사람이 있으면 다른 팀 합주가 막히고, 실패한 합주는 남지 않음");

  const rb = await q.createRehearsal(sql, { teamId: teamB, startAt: t(42), endAt: t(46) }); // 21–23, 맞닿기만 함
  ok("끝나는 시각에 바로 시작하는 합주는 허용");

  await expectCode("23P01", () => q.updateRehearsal(sql, ra, { startAt: t(43), endAt: t(45) }));
  assert.equal((await q.getRehearsal(sql, ra))!.startAt, t(38));
  ok("다른 합주와 겹치게 시간 변경하면 전체 취소");

  assert.ok(await q.updateRehearsal(sql, ra, { startAt: t(34), endAt: t(38) })); // 17–19
  const [pa] = await sql`SELECT DISTINCT start_at FROM rehearsal_participants WHERE rehearsal_id = ${ra}::uuid`;
  assert.equal(new Date(pa.start_at).toISOString(), t(34));
  ok("시간 변경이 참여자 시간까지 자동 반영");

  await q.updateRehearsal(sql, ra, { memo: "셋리스트 3곡" });
  const afterMemo = (await q.getRehearsal(sql, ra))!;
  assert.equal(afterMemo.memo, "셋리스트 3곡");
  assert.equal(afterMemo.startAt, t(34));
  ok("메모만 바꾸면 시간은 그대로");

  // 히트맵 데이터: B팀 화면에서 김드럼의 A팀 합주가 '이미 잡힌 시간'으로 보여야 함
  const grid = (await q.getTeamGrid(sql, teamB, "2030-02-25", "2030-03-04"))!;
  assert.equal(grid.busy.length, 1);
  assert.equal(grid.busy[0].memberId, kim.id);
  assert.equal(grid.busy[0].teamName, "A팀");
  assert.equal(grid.rehearsals.length, 1);
  assert.equal(grid.rehearsals[0].id, rb);
  ok("다른 팀 합주가 히트맵의 불가 시간으로 들어감");

  const mine = await q.listRehearsals(sql, { from: "2030-02-25", to: "2030-03-04", memberId: lee.id });
  assert.deepEqual(mine.map((r) => r.id), [ra]);
  ok("개인 캘린더는 내가 참여하는 합주만");

  // 팀원 변경: 박기타를 A팀에 넣으면 17–19는 비어 있으니 OK
  await q.setTeamMembers(sql, teamA, [kim.id, lee.id, park.id]);
  assert.equal((await q.getRehearsal(sql, ra))!.participants.length, 3);
  // 최보컬을 B팀에 넣기 전, 최보컬을 A팀 21:30–22:30 에 겹치게 넣어둠 → B팀 합류는 충돌
  await q.setTeamMembers(sql, teamA, [kim.id, lee.id]);
  assert.equal((await q.getRehearsal(sql, ra))!.participants.length, 2);
  const solo = await q.createTeam(sql, "최보컬 솔로", [choi.id]);
  await q.createRehearsal(sql, { teamId: solo, startAt: t(43), endAt: t(45) });
  await expectCode("23P01", () => q.setTeamMembers(sql, teamB, [kim.id, park.id, choi.id]));
  assert.equal((await q.getTeam(sql, teamB))!.members.length, 2);
  ok("팀원 변경이 예정된 합주 참여자에 반영되고, 충돌이면 전체 취소");

  // 수업 시간표: 통째로 바꾸기 · 팀 화면에 같이 내려감
  await q.replaceClasses(sql, park.id, [
    { weekday: 1, startMin: 720, endMin: 795, title: "논리회로" },
    { weekday: 3, startMin: 810, endMin: 885, title: "" },
  ]);
  await q.replaceClasses(sql, park.id, [{ weekday: 1, startMin: 990, endMin: 1065, title: "이산수학" }]);
  const cls = await q.listClasses(sql, [park.id, kim.id]);
  assert.deepEqual(cls[park.id], [{ weekday: 1, startMin: 990, endMin: 1065, title: "이산수학" }]);
  assert.deepEqual(cls[kim.id], []);
  const gridWithClasses = (await q.getTeamGrid(sql, teamB, "2030-02-25", "2030-03-04"))!;
  assert.equal(gridWithClasses.classes[park.id].length, 1);
  await expectCode("23514", () => q.replaceClasses(sql, park.id, [{ weekday: 1, startMin: 800, endMin: 700, title: "" }]));
  assert.equal((await q.listClasses(sql, [park.id]))[park.id].length, 1);
  ok("수업 시간표 저장 · 교체 · 잘못된 시간은 전체 취소");

  assert.ok(await q.deleteRehearsal(sql, rb));
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM rehearsal_participants WHERE rehearsal_id = ${rb}::uuid`;
  assert.equal(n, 0);
  ok("합주 취소 시 참여자도 같이 삭제");

  await q.deleteTeam(sql, teamA);
  assert.equal(await q.getRehearsal(sql, ra), null);
  ok("팀 삭제 시 그 팀 합주도 삭제");

  console.log(`\n${passed}개 통과`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
