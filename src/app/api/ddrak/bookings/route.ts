import { getSql, pgCode } from "@/lib/db";
import { handle, readJson, readRange } from "@/lib/api";
import { createBooking, listBookings } from "@/lib/ddrak";
import { requireClub } from "@/lib/ddrak-auth";
import { overlapError, readBookingInput } from "@/lib/ddrak-api";

/** ?from&to — 누구나 볼 수 있어요 */
export async function GET(req: Request) {
  return handle(async () => {
    const { from, to } = readRange(req);
    return Response.json(await listBookings(getSql(), from, to));
  });
}

/** 예약. 로그인한 동아리 이름으로 들어가요. body: { startAt, endAt, title?, bookedBy? } */
export async function POST(req: Request) {
  return handle(async () => {
    const club = requireClub(req);
    const input = readBookingInput(await readJson(req));
    const sql = getSql();
    try {
      return Response.json(await createBooking(sql, { club, ...input }), { status: 201 });
    } catch (err) {
      if (pgCode(err) === "23P01") throw await overlapError(sql, input.startAt, input.endAt);
      throw err;
    }
  });
}
