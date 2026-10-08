import type { NextRequest } from "next/server";
import { getSql } from "@/lib/db";
import { ApiError, handle, requireUuid } from "@/lib/api";
import { buildIcs } from "@/lib/ical";
import { getMember, listRehearsals } from "@/lib/queries";
import { addDays, todayKst } from "@/lib/time";

/**
 * 개인 캘린더 구독 피드 (.ics).
 * 구글·애플 캘린더에 이 주소를 한 번 추가하면 합주가 잡히거나 바뀔 때 알아서 따라와요.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/ical/[memberId]">) {
  return handle(async () => {
    const raw = (await ctx.params).memberId.replace(/\.ics$/, "");
    const memberId = requireUuid(raw, "멤버");
    const sql = getSql();
    const member = await getMember(sql, memberId);
    if (!member) throw new ApiError(404, "멤버를 찾을 수 없어요.");

    const today = todayKst();
    // 6주 단위 조회 제한은 API용이라, 여기서는 직접 넉넉하게 가져와요.
    const rehearsals = await listRehearsals(sql, { from: addDays(today, -30), to: addDays(today, 180), memberId });
    const body = buildIcs(`합주 · ${member.name}`, rehearsals, new URL(req.url).host);
    return new Response(body, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `inline; filename="rehearsals.ics"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
