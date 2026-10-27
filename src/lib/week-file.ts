import { addDays, SLOT_MINUTES, SLOTS_PER_DAY, slotLabel, weekdayIndex, type Day } from "./time";
import type { DaySlots } from "./types";

// 한 주의 가능 시간을 파일로 저장 · 불러오기.
// 사람이 열어서 읽고 고칠 수도 있게 시간은 "18:00-21:30" 같은 구간으로 적어요.
//
// {
//   "app": "합주표", "kind": "가능 시간", "version": 1,
//   "name": "악의꽃 40G 김민재", "weekStart": "2026-10-26",
//   "days": { "월": ["18:00-21:30"], "화": [], ... }
// }

export const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"] as const;

export type WeekFile = {
  app: "합주표";
  kind: "가능 시간";
  version: 1;
  name: string;
  weekStart: Day;
  days: Record<(typeof WEEKDAYS)[number], string[]>;
};

/** 칸 번호들 → ["18:00-21:30", ...] */
function toRanges(slots: number[]): string[] {
  const sorted = [...new Set(slots)].filter((s) => s >= 0 && s < SLOTS_PER_DAY).sort((a, b) => a - b);
  const out: string[] = [];
  let start = -1;
  let prev = -2;
  for (const s of [...sorted, Infinity]) {
    if (s !== prev + 1) {
      if (start >= 0) out.push(`${slotLabel(start)}-${slotLabel(prev + 1)}`);
      start = s;
    }
    prev = s;
  }
  return out;
}

/** "18:00-21:30" → 칸 번호들 (30분 단위로 맞지 않으면 걸치는 칸을 모두 포함) */
function fromRange(range: string): number[] {
  const m = /^\s*(\d{1,2}):(\d{2})\s*[-~–]\s*(\d{1,2}):(\d{2})\s*$/.exec(range);
  if (!m) throw new Error(`"${range}" 형식을 읽을 수 없어요. "18:00-21:30"처럼 적어야 해요.`);
  const a = Number(m[1]) * 60 + Number(m[2]);
  const b = Number(m[3]) * 60 + Number(m[4]);
  if (Number(m[2]) > 59 || Number(m[4]) > 59 || a >= b || b > 24 * 60) throw new Error(`"${range}" 시간이 올바르지 않아요.`);
  const out: number[] = [];
  for (let i = Math.floor(a / SLOT_MINUTES); i < Math.ceil(b / SLOT_MINUTES); i++) out.push(i);
  return out;
}

export function buildWeekFile(name: string, days: Day[], avail: DaySlots): WeekFile {
  const out = Object.fromEntries(WEEKDAYS.map((w) => [w, [] as string[]])) as WeekFile["days"];
  for (const day of days) out[WEEKDAYS[weekdayIndex(day)]] = toRanges(avail[day] ?? []);
  return { app: "합주표", kind: "가능 시간", version: 1, name, weekStart: days[0], days: out };
}

export function weekFileName(name: string, weekStart: Day) {
  return `합주표_${name.replace(/[\\/:*?"<>|\s]+/g, "_")}_${weekStart}주.json`;
}

/** 파일 내용 → 요일(0=월)별 칸 번호. 잘못된 파일이면 사람이 읽을 수 있는 문장으로 throw */
export function parseWeekFile(text: string): { byWeekday: number[][]; name: string | null; weekStart: Day | null } {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    throw new Error("합주표에서 내려받은 일정 파일(.json)이 아니에요.");
  }
  const o = data as Partial<WeekFile> | null;
  if (!o || typeof o !== "object" || o.app !== "합주표" || !o.days || typeof o.days !== "object") {
    throw new Error("합주표에서 내려받은 일정 파일이 아니에요.");
  }
  const byWeekday = WEEKDAYS.map((w) => {
    const ranges = (o.days as Record<string, unknown>)[w] ?? [];
    if (!Array.isArray(ranges)) throw new Error(`${w}요일 값이 올바르지 않아요.`);
    return [...new Set(ranges.flatMap((r) => fromRange(String(r))))].sort((a, b) => a - b);
  });
  return {
    byWeekday,
    name: typeof o.name === "string" ? o.name : null,
    weekStart: typeof o.weekStart === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.weekStart) ? o.weekStart : null,
  };
}

/** "10/26–11/1" */
export function weekRangeLabel(weekStart: Day) {
  const f = (d: Day) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  return `${f(weekStart)}–${f(addDays(weekStart, 6))}`;
}
