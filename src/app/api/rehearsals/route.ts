import { getSql, pgCode } from "@/lib/db";
import { ApiError, handle, isUuid, readJson, readRange, requireTimeRange, requireUuid } from "@/lib/api";
import { createRehearsal, findConflicts, getRehearsal, getTeam, listRehearsals } from "@/lib/queries";

/** ?from&to[&member=] — 기간 안의 합주 (member를 주면 그 사람이 참여하는 것만) */
export async function GET(req: Request) {
  return handle(async () => {
    const { from, to } = readRange(req);
    const member = new URL(req.url).searchParams.get("member");
    if (member && !isUuid(member)) throw new ApiError(400, "멤버 형식이 올바르지 않아요.");
    return Response.json(await listRehearsals(getSql(), { from, to, memberId: member || null }));
  });
}

/** 합주 확정. body: { teamId, startAt, endAt, memo?, createdBy? } */
export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson(req);
    const teamId = requireUuid(body.teamId, "팀");
    const { startAt, endAt } = requireTimeRange(body.startAt, body.endAt);
    const memo = typeof body.memo === "string" && body.memo.trim() ? body.memo.trim().slice(0, 200) : null;
    const createdBy = typeof body.createdBy === "string" ? body.createdBy.slice(0, 30) : null;

    const sql = getSql();
    const team = await getTeam(sql, teamId);
    if (!team) throw new ApiError(404, "팀을 찾을 수 없어요.");
    if (team.members.length === 0) throw new ApiError(400, "팀원이 있어야 합주를 잡을 수 있어요.");

    try {
      const id = await createRehearsal(sql, { teamId, startAt, endAt, memo, createdBy });
      return Response.json(await getRehearsal(sql, id), { status: 201 });
    } catch (err) {
      if (pgCode(err) !== "23P01") throw err;
      const conflicts = await findConflicts(sql, team.members.map((m) => m.id), startAt, endAt);
      throw new ApiError(409, "이 시간에 다른 합주가 있는 팀원이 있어요.", { conflicts });
    }
  });
}
