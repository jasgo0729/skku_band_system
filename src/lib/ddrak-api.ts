import { ApiError, requireTimeRange } from "@/lib/api";
import type { Sql } from "@/lib/db";
import { rangeLabel, SLOT_MINUTES } from "@/lib/time";
import { overlapping } from "@/lib/ddrak";
import { clubName } from "@/lib/ddrak-clubs";

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ").slice(0, max) : null);

/** 예약 입력 검증: 30분 단위, 최대 8시간, 지난 시간은 안 됨 */
export function readBookingInput(body: Record<string, unknown>) {
  const { startAt, endAt } = requireTimeRange(body.startAt, body.endAt);
  const slotMs = SLOT_MINUTES * 60 * 1000;
  const currentSlot = Math.floor(Date.now() / slotMs) * slotMs;
  if (new Date(startAt).getTime() < currentSlot) throw new ApiError(400, "이미 지난 시간은 예약할 수 없어요.");
  return { startAt, endAt, title: text(body.title, 60), bookedBy: text(body.bookedBy, 30) };
}

/** 겹침(23P01) 에러를 사람이 읽을 문장으로 */
export async function overlapError(sql: Sql, startAt: string, endAt: string, excludeId: string | null = null) {
  const hits = await overlapping(sql, startAt, endAt, excludeId);
  const detail = hits.map((h) => `${clubName(h.club)} ${rangeLabel(h.startAt, h.endAt)}`).join(", ");
  return new ApiError(409, detail ? `그 시간엔 이미 예약이 있어요: ${detail}` : "그 시간엔 이미 예약이 있어요.");
}
