import type { NextRequest } from "next/server";
import { getSql } from "@/lib/db";
import { ApiError, handle, readRange, requireUuid } from "@/lib/api";
import { getTeamGrid } from "@/lib/queries";

/** 팀 히트맵에 필요한 것 한 번에: 팀원, 각자 가능 시간, 다른 팀 합주로 막힌 시간, 이 팀 합주 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/teams/[id]/grid">) {
  return handle(async () => {
    const teamId = requireUuid((await ctx.params).id, "팀");
    const { from, to } = readRange(req);
    const grid = await getTeamGrid(getSql(), teamId, from, to);
    if (!grid) throw new ApiError(404, "팀을 찾을 수 없어요.");
    return Response.json(grid);
  });
}
