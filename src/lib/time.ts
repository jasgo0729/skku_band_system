// 모든 날짜·시간은 한국 시간(UTC+9, 서머타임 없음) 기준으로 다뤄요.
// 화면과 DB 사이에서는 30분 단위 "칸 번호"를 써요. 0 = 00:00, 18 = 09:00, 47 = 23:30.

export const SLOT_MINUTES = 30;
export const SLOTS_PER_DAY = 48;
/** 그리드에 보이는 시간대: 00:00 ~ 24:00 (처음엔 09:00 근처로 스크롤돼요) */
export const GRID_FIRST_SLOT = 0;
export const GRID_END_SLOT = 48;
/** 합주 한 번 최대 길이 */
export const MAX_REHEARSAL_SLOTS = 16; // 8시간

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export type Day = string; // "YYYY-MM-DD"

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function todayKst(): Day {
  return new Date(Date.now() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export function isDay(value: unknown): value is Day {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

function dayToUtcMidnight(day: Day): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(day: Day, n: number): Day {
  return new Date(dayToUtcMidnight(day) + n * DAY_MS).toISOString().slice(0, 10);
}

/** 그 주의 월요일 */
export function weekStart(day: Day): Day {
  const dow = new Date(dayToUtcMidnight(day)).getUTCDay(); // 0 = 일
  return addDays(day, dow === 0 ? -6 : 1 - dow);
}

export function weekDays(start: Day): Day[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** 칸 시작 시각 → ISO 문자열 (idx 48이면 다음날 00:00) */
export function slotToIso(day: Day, idx: number): string {
  const ms = dayToUtcMidnight(day) - KST_OFFSET_MS + idx * SLOT_MINUTES * 60 * 1000;
  return new Date(ms).toISOString();
}

/** ISO 시각 → 한국 시간 기준 날짜와 칸 번호 */
export function isoToSlot(iso: string | Date): { day: Day; idx: number } {
  const ms = new Date(iso).getTime() + KST_OFFSET_MS;
  const d = new Date(ms);
  const day = d.toISOString().slice(0, 10);
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  return { day, idx: Math.floor(minutes / SLOT_MINUTES) };
}

/** 30분 단위에 딱 맞는 시각인지 */
export function isOnSlotBoundary(iso: string): boolean {
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && t % (SLOT_MINUTES * 60 * 1000) === 0;
}

export function slotLabel(idx: number): string {
  const minutes = idx * SLOT_MINUTES;
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

export function dayLabel(day: Day): string {
  const [, m, d] = day.split("-").map(Number);
  const dow = new Date(dayToUtcMidnight(day)).getUTCDay();
  return `${m}/${d} (${WEEKDAYS[dow]})`;
}

export function weekdayOf(day: Day): string {
  return WEEKDAYS[new Date(dayToUtcMidnight(day)).getUTCDay()];
}

export function dateNumber(day: Day): string {
  const [, m, d] = day.split("-").map(Number);
  return `${m}/${d}`;
}

/** "10/10 (금) 19:00–21:00" */
export function rangeLabel(startIso: string | Date, endIso: string | Date): string {
  const s = isoToSlot(startIso);
  const base = new Date(slotToIso(s.day, 0)).getTime();
  const endIdx = Math.round((new Date(endIso).getTime() - base) / (SLOT_MINUTES * 60 * 1000));
  return `${dayLabel(s.day)} ${slotLabel(s.idx)}–${slotLabel(endIdx)}`; // 자정이면 24:00
}

export function weekLabel(start: Day): string {
  const end = addDays(start, 6);
  const [y, m, d] = start.split("-").map(Number);
  const [, m2, d2] = end.split("-").map(Number);
  return m === m2 ? `${y}년 ${m}월 ${d}–${d2}일` : `${y}년 ${m}월 ${d}일 – ${m2}월 ${d2}일`;
}

/** 일정이 이번 주 그리드의 몇 번째 요일, 몇 번째 칸부터 몇 칸까지인지 (보이는 범위로 자름) */
export function spanOnGrid(
  startIso: string,
  endIso: string,
  days: Day[],
): { d: number; start: number; end: number } | null {
  const s = isoToSlot(startIso);
  const d = days.indexOf(s.day);
  if (d < 0) return null;
  const base = new Date(slotToIso(s.day, 0)).getTime();
  const endIdx = Math.ceil((new Date(endIso).getTime() - base) / (SLOT_MINUTES * 60 * 1000));
  const start = Math.max(s.idx, GRID_FIRST_SLOT);
  const end = Math.min(endIdx, GRID_END_SLOT);
  if (end <= start) return null;
  return { d, start, end };
}

/** 월 = 0 ... 일 = 6 */
export function weekdayIndex(day: Day): number {
  const dow = new Date(dayToUtcMidnight(day)).getUTCDay();
  return (dow + 6) % 7;
}

export const WEEKDAY_NAMES = ["월", "화", "수", "목", "금", "토", "일"];

/** 수업이 걸치는 30분 칸 [start, end) — 조금이라도 겹치면 그 칸은 불가 */
export function minutesToSlots(startMin: number, endMin: number): { start: number; end: number } {
  return { start: Math.floor(startMin / SLOT_MINUTES), end: Math.ceil(endMin / SLOT_MINUTES) };
}

/** 720 → "12:00" */
export function minutesLabel(min: number): string {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

/** "12:00" → 720 (24:00 허용) */
export function parseMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59 || h > 24 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}
