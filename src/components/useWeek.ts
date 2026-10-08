"use client";

import { useEffect, useMemo, useState } from "react";
import { addDays, todayKst, weekDays, weekLabel, weekStart, type Day } from "@/lib/time";

export function useWeek() {
  const [start, setStart] = useState<Day>(() => weekStart(todayKst()));
  const days = useMemo(() => weekDays(start), [start]);
  return {
    start,
    days,
    from: start,
    to: addDays(start, 7),
    label: weekLabel(start),
    prev: () => setStart((s) => addDays(s, -7)),
    next: () => setStart((s) => addDays(s, 7)),
    thisWeek: () => setStart(weekStart(todayKst())),
  };
}

/** 주기적으로 + 창에 다시 돌아왔을 때 새로고침 (다른 사람이 바꾼 내용 반영) */
export function useRefresh(fn: () => void, ms = 20000) {
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") fn();
    }, ms);
    const onFocus = () => fn();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [fn, ms]);
}
