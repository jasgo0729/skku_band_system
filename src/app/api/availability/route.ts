import { getSql } from "@/lib/db";
import { ApiError, handle, readJson, readRange, requireUuid } from "@/lib/api";
import { getAvailability, getMember, saveAvailability } from "@/lib/queries";
import { isDay, SLOTS_PER_DAY } from "@/lib/time";
import type { DaySlots } from "@/lib/types";

export async function GET(req: Request) {
  return handle(async () => {
    const memberId = requireUuid(new URL(req.url).searchParams.get("member"), "멤버");
    const { from, to } = readRange(req);
    const all = await getAvailability(getSql(), [memberId], from, to);
    return Response.json(all[memberId] ?? {});
  });
}

/** body: { memberId, days: { "2026-10-10": [36, 37, 38], ... } } — 넘긴 날짜만 덮어써요 */
export async function PUT(req: Request) {
  return handle(async () => {
    const body = await readJson(req);
    const memberId = requireUuid(body.memberId, "멤버");
    const raw = body.days;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ApiError(400, "days 형식이 올바르지 않아요.");
    const entries = Object.entries(raw as Record<string, unknown>);
    if (entries.length > 62) throw new ApiError(400, "한 번에 62일까지만 저장할 수 있어요.");

    const days: DaySlots = {};
    for (const [day, slots] of entries) {
      if (!isDay(day) || !Array.isArray(slots)) throw new ApiError(400, "days 형식이 올바르지 않아요.");
      if (!slots.every((s) => Number.isInteger(s) && s >= 0 && s < SLOTS_PER_DAY)) {
        throw new ApiError(400, "시간 칸 번호가 올바르지 않아요.");
      }
      days[day] = slots as number[];
    }

    const sql = getSql();
    if (!(await getMember(sql, memberId))) throw new ApiError(404, "멤버를 찾을 수 없어요.");
    await saveAvailability(sql, memberId, days);
    return Response.json({ ok: true });
  });
}
