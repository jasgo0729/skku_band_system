import type { NextRequest } from "next/server";
import { getSql, pgCode } from "@/lib/db";
import { ApiError, handle, isUuid, readJson, requireUuid } from "@/lib/api";
import { findConflicts, getTeam, listRehearsals, setTeamMembers } from "@/lib/queries";
import { addDays, todayKst } from "@/lib/time";
import type { Conflict } from "@/lib/types";

/** body: { memberIds: [...] } — 팀원 전체를 이 목록으로 맞춰요. 예정된 합주 참여자도 같이 바뀌어요. */
export async function PUT(req: NextRequest, ctx: RouteContext<"/api/teams/[id]/members">) {
  return handle(async () => {
    const teamId = requireUuid((await ctx.params).id, "팀");
    const memberIds = (await readJson(req)).memberIds;
    if (!Array.isArray(memberIds) || !memberIds.every(isUuid)) throw new ApiError(400, "멤버 목록이 올바르지 않아요.");
    const ids = [...new Set(memberIds)];
    const sql = getSql();
    const before = await getTeam(sql, teamId);
    if (!before) throw new ApiError(404, "팀을 찾을 수 없어요.");

    try {
      await setTeamMembers(sql, teamId, ids);
    } catch (err) {
      if (pgCode(err) !== "23P01") throw err;
      // 새로 들어오는 사람이 이 팀의 예정된 합주 시간에 다른 합주가 있는 경우
      const added = ids.filter((id) => !before.members.some((m) => m.id === id));
      const today = todayKst();
      const upcoming = await listRehearsals(sql, { from: today, to: addDays(today, 42), teamId });
      const conflicts: Conflict[] = [];
      for (const r of upcoming) {
        if (new Date(r.startAt) <= new Date()) continue;
        conflicts.push(...(await findConflicts(sql, added, r.startAt, r.endAt, r.id)));
      }
      throw new ApiError(409, "새 멤버가 이 팀의 예정된 합주 시간에 다른 합주가 있어요.", { conflicts });
    }
    return Response.json(await getTeam(sql, teamId));
  });
}
