import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "./api";
import { CLUBS, isClub, type ClubSlug } from "./ddrak-clubs";

// 뜨락 관리자 로그인. 동아리마다 계정 하나 = 비밀번호 하나를 Vercel 환경변수로 정해요.
//   DDRAK_PW_AKUI   악의꽃
//   DDRAK_PW_MAKMU  막무간애
//   DDRAK_PW_MOYEO  모여락
// 비밀번호를 바꾸면 그 동아리의 기존 로그인은 자동으로 풀려요.

const ENV_KEY: Record<ClubSlug, string> = {
  akui: "DDRAK_PW_AKUI",
  makmu: "DDRAK_PW_MAKMU",
  moyeo: "DDRAK_PW_MOYEO",
};

export const SESSION_COOKIE = "ddrak_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30일

function passwordOf(club: ClubSlug): string {
  return process.env[ENV_KEY[club]] ?? "";
}

export function enabledClubs(): ClubSlug[] {
  return CLUBS.map((c) => c.slug).filter((s) => passwordOf(s).length > 0);
}

const sha = (s: string) => createHash("sha256").update(s).digest();

export function checkPassword(club: ClubSlug, input: string): boolean {
  const pw = passwordOf(club);
  if (!pw) return false;
  return timingSafeEqual(sha(pw), sha(input));
}

/** 서명 키에 그 동아리 비밀번호를 섞어서, 비밀번호가 바뀌면 옛 쿠키는 무효가 돼요 */
function sign(club: ClubSlug, iat: number): string {
  const key = createHmac("sha256", process.env.ddrak_SESSION_SECRET ?? "ddrak").update(`${club}\0${passwordOf(club)}`).digest();
  return createHmac("sha256", key).update(`${club}.${iat}`).digest("base64url");
}

export function makeToken(club: ClubSlug, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  return `${club}.${iat}.${sign(club, iat)}`;
}

export function verifyToken(token: string | undefined, now = Date.now()): ClubSlug | null {
  if (!token) return null;
  const [club, iatRaw, sig] = token.split(".");
  const iat = Number(iatRaw);
  if (!isClub(club) || !passwordOf(club) || !Number.isInteger(iat) || !sig) return null;
  if (now / 1000 - iat > MAX_AGE_SEC || iat > now / 1000 + 60) return null;
  const expected = Buffer.from(sign(club, iat));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given) ? club : null;
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function sessionClub(req: Request): ClubSlug | null {
  return verifyToken(readCookie(req, SESSION_COOKIE));
}

export function requireClub(req: Request): ClubSlug {
  const club = sessionClub(req);
  if (!club) throw new ApiError(401, "뜨락 예약은 동아리 관리자로 로그인해야 할 수 있어요.");
  return club;
}

export function sessionCookie(req: Request, token: string | null): string {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return token
    ? `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SEC}${secure}`
    : `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

// 비밀번호 마구 넣어보기 방지 (서버 인스턴스별, 10분에 10번)
const attempts = new Map<string, number[]>();
export function limitLogin(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const recent = (attempts.get(ip) ?? []).filter((t) => now - t < 10 * 60 * 1000);
  if (recent.length >= 10) throw new ApiError(429, "로그인 시도가 너무 많아요. 10분 뒤에 다시 해 주세요.");
  recent.push(now);
  attempts.set(ip, recent);
}
