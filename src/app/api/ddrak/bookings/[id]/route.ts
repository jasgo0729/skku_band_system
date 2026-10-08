import type { NextRequest } from "next/server";
import { getSql, pgCode } from "@/lib/db";
import { ApiError, handle, readJson, requireUuid } from "@/lib/api";
import { deleteBooking, getBooking, updateBooking } from "@/lib/ddrak";
import { requireClub } from "@/lib/ddrak-auth";
import { clubName } from "@/lib/ddrak-clubs";
import { overlapError, readBookingInput } from "@/lib/ddrak-api";

/** 우리 동아리 예약인지 확인 */
async function ownBooking(req: Request, id: string) {
  const club = requireClub(req);
  const sql = getSql();
  const booking = await getBooking(sql, id);
  if (!booking) throw new ApiError(404, "예약을 찾을 수 없어요. 이미 취소됐을 수 있어요.");
  if (booking.club !== club) throw new ApiError(403, `${clubName(booking.club)} 예약은 ${clubName(booking.club)} 관리자만 바꿀 수 있어요.`);
  return { sql, booking };
}

/** 시간 옮기기 · 내용 수정. body: { startAt, endAt, title?, bookedBy? } */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/ddrak/bookings/[id]">) {
  return handle(async () => {
    const id = requireUuid((await ctx.params).id, "예약");
    const { sql, booking } = await ownBooking(req, id);
    const body = await readJson(req);
    const input = readBookingInput({
      startAt: body.startAt ?? booking.startAt,
      endAt: body.endAt ?? booking.endAt,
      title: body.title === undefined ? booking.title : body.title,
      bookedBy: body.bookedBy === undefined ? booking.bookedBy : body.bookedBy,
    });
    try {
      return Response.json(await updateBooking(sql, id, input));
    } catch (err) {
      if (pgCode(err) === "23P01") throw await overlapError(sql, input.startAt, input.endAt, id);
      throw err;
    }
  });
}

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/ddrak/bookings/[id]">) {
  return handle(async () => {
    const id = requireUuid((await ctx.params).id, "예약");
    const { sql } = await ownBooking(req, id);
    await deleteBooking(sql, id);
    return Response.json({ ok: true });
  });
}
