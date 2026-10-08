import type { NextRequest } from "next/server";
import { getSql } from "@/lib/db";
import { ApiError, handle, readJson, requireName, requireUuid } from "@/lib/api";
import { deleteTeam, getTeam, renameTeam } from "@/lib/queries";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/teams/[id]">) {
  return handle(async () => {
    const id = requireUuid((await ctx.params).id, "팀");
    const team = await getTeam(getSql(), id);
    if (!team) throw new ApiError(404, "팀을 찾을 수 없어요.");
    return Response.json(team);
  });
}

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/teams/[id]">) {
  return handle(async () => {
    const id = requireUuid((await ctx.params).id, "팀");
    const name = requireName((await readJson(req)).name, 40, "팀 이름");
    const sql = getSql();
    await renameTeam(sql, id, name);
    return Response.json(await getTeam(sql, id));
  });
}

/** 팀을 지우면 그 팀의 합주도 모두 지워져요 */
export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/teams/[id]">) {
  return handle(async () => {
    const id = requireUuid((await ctx.params).id, "팀");
    await deleteTeam(getSql(), id);
    return Response.json({ ok: true });
  });
}
