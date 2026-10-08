import { connection } from "next/server";
import { getSql } from "@/lib/db";
import { ApiError, handle, isUuid, readJson, requireName } from "@/lib/api";
import { createTeam, getTeam, listTeams } from "@/lib/queries";

export async function GET() {
  await connection();
  return handle(async () => Response.json(await listTeams(getSql())));
}

export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson(req);
    const name = requireName(body.name, 40, "팀 이름");
    const memberIds = body.memberIds ?? [];
    if (!Array.isArray(memberIds) || !memberIds.every(isUuid)) throw new ApiError(400, "멤버 목록이 올바르지 않아요.");
    const sql = getSql();
    const id = await createTeam(sql, name, [...new Set(memberIds)]);
    return Response.json(await getTeam(sql, id), { status: 201 });
  });
}
