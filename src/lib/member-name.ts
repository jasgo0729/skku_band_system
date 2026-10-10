import { CLUBS } from "./ddrak-clubs";

// 멤버 이름 규칙: "악의꽃 40G 김민재" = 동아리 + 기수 + 세션 약자 + 이름
// 이름 입력 화면에서 만들고, 팀원 고르는 화면에서 다시 쪼개서 써요.

export const SESSIONS = [
  { label: "보컬", code: "V" },
  { label: "기타", code: "G" },
  { label: "베이스", code: "B" },
  { label: "드럼", code: "D" },
  { label: "키보드", code: "K" },
] as const;

export type SessionCode = (typeof SESSIONS)[number]["code"];

export function sessionLabel(code: string): string {
  return SESSIONS.find((s) => s.code === code)?.label ?? code;
}

/** 동아리 · 기수 · 세션 · 이름 → "악의꽃 40G 김민재" */
export function composeName(club: string, gen: string, session: string, name: string) {
  return `${club} ${gen}${session} ${name.trim().replace(/\s+/g, " ")}`;
}

export type ParsedName = { club: string; gen: number; session: SessionCode; name: string };

const PATTERN = new RegExp(`^(${CLUBS.map((c) => c.name).join("|")})\\s+(\\d{1,3})\\s*([VGBDK])\\s+(.+)$`, "i");

/** "악의꽃 40G 김민재" → { club: "악의꽃", gen: 40, session: "G", name: "김민재" }. 형식이 다르면 null */
export function parseName(full: string): ParsedName | null {
  const m = PATTERN.exec(full.trim());
  if (!m) return null;
  return { club: m[1], gen: Number(m[2]), session: m[3].toUpperCase() as SessionCode, name: m[4].trim() };
}
