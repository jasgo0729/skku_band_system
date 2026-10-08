"use client";

import type { Conflict } from "./types";
import { rangeLabel } from "./time";

export class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public conflicts: Conflict[] = [],
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new RequestError(data.error ?? `요청이 실패했어요 (${res.status})`, res.status, data.conflicts ?? []);
  }
  return data as T;
}

/** 409 충돌을 사람이 읽을 문장으로 */
export function describeError(err: unknown): string {
  if (err instanceof RequestError) {
    if (err.conflicts.length > 0) {
      const lines = err.conflicts.map((c) => `${c.memberName} — ${c.teamName} ${rangeLabel(c.startAt, c.endAt)}`);
      return `${err.message}\n${[...new Set(lines)].join("\n")}`;
    }
    return err.message;
  }
  return "네트워크 오류가 났어요. 연결을 확인하고 다시 시도하세요.";
}

const STORAGE_KEY = "band-sync:me";

export function loadMe(): { id: string; name: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return typeof v?.id === "string" && typeof v?.name === "string" ? v : null;
  } catch {
    return null;
  }
}

export function saveMe(me: { id: string; name: string } | null) {
  try {
    if (me) localStorage.setItem(STORAGE_KEY, JSON.stringify(me));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
}
