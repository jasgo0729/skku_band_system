import { pgCode } from "./db";
import { isDay, isOnSlotBoundary, MAX_REHEARSAL_SLOTS, SLOT_MINUTES, type Day } from "./time";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

export function requireUuid(v: unknown, what = "id"): string {
  if (!isUuid(v)) throw new ApiError(400, `${what} 형식이 올바르지 않아요.`);
  return v;
}

export function requireName(v: unknown, max: number, what: string): string {
  const name = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
  if (!name) throw new ApiError(400, `${what}을(를) 입력하세요.`);
  if (name.length > max) throw new ApiError(400, `${what}은(는) ${max}자 이하로 입력하세요.`);
  return name;
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {}
  throw new ApiError(400, "요청 형식이 올바르지 않아요.");
}

/** ?from=YYYY-MM-DD&to=YYYY-MM-DD (to는 포함하지 않음, 최대 42일) */
export function readRange(req: Request): { from: Day; to: Day } {
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!isDay(from) || !isDay(to) || to <= from) throw new ApiError(400, "기간(from, to)이 올바르지 않아요.");
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 42) throw new ApiError(400, "한 번에 6주까지만 조회할 수 있어요.");
  return { from, to };
}

/** 합주 시작·끝 검증 */
export function requireTimeRange(startAt: unknown, endAt: unknown): { startAt: string; endAt: string } {
  if (typeof startAt !== "string" || typeof endAt !== "string" || !isOnSlotBoundary(startAt) || !isOnSlotBoundary(endAt)) {
    throw new ApiError(400, "시간은 30분 단위로 선택하세요.");
  }
  const s = new Date(startAt).getTime();
  const e = new Date(endAt).getTime();
  if (e <= s) throw new ApiError(400, "끝나는 시간이 시작보다 늦어야 해요.");
  if (e - s > MAX_REHEARSAL_SLOTS * SLOT_MINUTES * 60 * 1000) {
    throw new ApiError(400, `합주는 한 번에 ${(MAX_REHEARSAL_SLOTS * SLOT_MINUTES) / 60}시간까지 잡을 수 있어요.`);
  }
  return { startAt: new Date(s).toISOString(), endAt: new Date(e).toISOString() };
}

/** 라우트 핸들러 공통 에러 처리 */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError) {
      return Response.json({ error: err.message, ...err.extra }, { status: err.status });
    }
    const code = pgCode(err);
    if (code === "23505") return Response.json({ error: "같은 이름이 이미 있어요." }, { status: 409 });
    if (code === "23503") return Response.json({ error: "대상을 찾을 수 없어요. 새로고침 후 다시 시도하세요." }, { status: 404 });
    if (code === "23514") return Response.json({ error: "입력값이 허용 범위를 벗어났어요." }, { status: 400 });
    console.error(err);
    return Response.json({ error: "서버 오류가 났어요. 잠시 후 다시 시도하세요." }, { status: 500 });
  }
}

/** 수업 목록 검증 · 정리 (겹치거나 같은 칸은 그대로 둬도 계산엔 문제 없어요) */
export function normalizeClasses(raw: unknown): import("./types").ClassBlock[] {
  if (!Array.isArray(raw)) throw new ApiError(400, "수업 목록 형식이 올바르지 않아요.");
  if (raw.length > 60) throw new ApiError(400, "수업은 60개까지 저장할 수 있어요.");
  return raw.map((c, i) => {
    const o = (c ?? {}) as Record<string, unknown>;
    const weekday = Number(o.weekday);
    const startMin = Number(o.startMin);
    const endMin = Number(o.endMin);
    const title = typeof o.title === "string" ? o.title.trim().slice(0, 60) : "";
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new ApiError(400, `${i + 1}번째 수업의 요일이 올바르지 않아요.`);
    if (!Number.isInteger(startMin) || !Number.isInteger(endMin) || startMin < 0 || endMin > 1440 || endMin <= startMin) {
      throw new ApiError(400, `${i + 1}번째 수업의 시간이 올바르지 않아요. 끝나는 시간이 시작보다 늦어야 해요.`);
    }
    return { weekday, startMin, endMin, title };
  });
}
