import { connection } from "next/server";
import { getSql } from "@/lib/db";
import { ApiError, handle, isUuid, readJson, requireName } from "@/lib/api";
import { createTeam, getTeam, listTeams } from "@/lib/queries";
import { isClub } from "@/lib/ddrak-clubs";

/** ?club=akui — 그 동아리 팀만 */
export async function GET(req: Request) {
  await connection();
  return handle(async () => {
    const club = new URL(req.url).searchParams.get("club");
    if (club && !isClub(club)) throw new ApiError(400, "동아리가 올바르지 않아요.");
    return Response.json(await listTeams(getSql(), club || null));
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson(req);
    const name = requireName(body.name, 40, "팀 이름");
    const memberIds = body.memberIds ?? [];
    if (!Array.isArray(memberIds) || !memberIds.every(isUuid)) throw new ApiError(400, "멤버 목록이 올바르지 않아요.");
    if (body.club != null && !isClub(body.club)) throw new ApiError(400, "동아리가 올바르지 않아요.");
    const sql = getSql();
    const id = await createTeam(sql, name, [...new Set(memberIds)], body.club ?? null);
    return Response.json(await getTeam(sql, id), { status: 201 });
  });
}
