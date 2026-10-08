import { minutesToSlots } from "./time";
import type { ClassBlock } from "./types";

/** (요일, 칸) → 그 칸에 걸친 수업 이름들. 없으면 undefined */
export type ClassIndex = (weekday: number, slot: number) => string[] | undefined;

export function buildClassIndex(classes: ClassBlock[]): ClassIndex {
  const map = new Map<string, string[]>();
  for (const c of classes) {
    const { start, end } = minutesToSlots(c.startMin, c.endMin);
    for (let i = start; i < end; i++) {
      const k = `${c.weekday}|${i}`;
      map.set(k, [...(map.get(k) ?? []), c.title || "수업"]);
    }
  }
  return (weekday, slot) => map.get(`${weekday}|${slot}`);
}
