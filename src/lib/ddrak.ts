import type { Sql } from "./db";
import { slotToIso, type Day } from "./time";
import type { ClubSlug, ddrakBooking } from "./ddrak-clubs";

type Row = { id: string; club: ClubSlug; start_at: unknown; end_at: unknown; title: string | null; booked_by: string | null };

const toBooking = (r: Row): ddrakBooking => ({
  id: r.id,
  club: r.club,
  startAt: new Date(r.start_at as string).toISOString(),
  endAt: new Date(r.end_at as string).toISOString(),
  title: r.title,
  bookedBy: r.booked_by,
});

export async function listBookings(sql: Sql, from: Day, to: Day): Promise<ddrakBooking[]> {
  const rows = await sql`
    SELECT id, club, start_at, end_at, title, booked_by FROM ddrak_bookings
     WHERE start_at < ${slotToIso(to, 0)}::timestamptz AND end_at > ${slotToIso(from, 0)}::timestamptz
     ORDER BY start_at`;
  return rows.map(toBooking);
}

export async function getBooking(sql: Sql, id: string): Promise<ddrakBooking | null> {
  const [row] = await sql`SELECT id, club, start_at, end_at, title, booked_by FROM ddrak_bookings WHERE id = ${id}::uuid`;
  return row ? toBooking(row) : null;
}

/** 겹치면 23P01 에러 */
export async function createBooking(
  sql: Sql,
  b: { club: ClubSlug; startAt: string; endAt: string; title: string | null; bookedBy: string | null },
): Promise<ddrakBooking> {
  const [row] = await sql`
    INSERT INTO ddrak_bookings (club, start_at, end_at, title, booked_by)
    VALUES (${b.club}, ${b.startAt}::timestamptz, ${b.endAt}::timestamptz, ${b.title}, ${b.bookedBy})
    RETURNING id, club, start_at, end_at, title, booked_by`;
  return toBooking(row);
}

/** 겹치면 23P01 에러 */
export async function updateBooking(
  sql: Sql,
  id: string,
  b: { startAt: string; endAt: string; title: string | null; bookedBy: string | null },
): Promise<ddrakBooking | null> {
  const [row] = await sql`
    UPDATE ddrak_bookings
       SET start_at = ${b.startAt}::timestamptz, end_at = ${b.endAt}::timestamptz,
           title = ${b.title}, booked_by = ${b.bookedBy}, updated_at = now()
     WHERE id = ${id}::uuid
     RETURNING id, club, start_at, end_at, title, booked_by`;
  return row ? toBooking(row) : null;
}

export async function deleteBooking(sql: Sql, id: string): Promise<void> {
  await sql`DELETE FROM ddrak_bookings WHERE id = ${id}::uuid`;
}

/** 그 시간에 이미 있는 예약 (에러 메시지용) */
export async function overlapping(sql: Sql, startAt: string, endAt: string, excludeId: string | null = null): Promise<ddrakBooking[]> {
  const rows = await sql`
    SELECT id, club, start_at, end_at, title, booked_by FROM ddrak_bookings
     WHERE start_at < ${endAt}::timestamptz AND end_at > ${startAt}::timestamptz
       AND (${excludeId}::uuid IS NULL OR id <> ${excludeId}::uuid)
     ORDER BY start_at`;
  return rows.map(toBooking);
}
