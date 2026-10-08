import { ApiError, handle, readJson } from "@/lib/api";
import { checkPassword, enabledClubs, limitLogin, makeToken, sessionClub, sessionCookie } from "@/lib/ddrak-auth";
import { isClub, type ddrakSession } from "@/lib/ddrak-clubs";

/** 지금 로그인한 동아리 */
export async function GET(req: Request) {
  return handle(async () => {
    const body: ddrakSession = { club: sessionClub(req), enabled: enabledClubs() };
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  });
}

/** 로그인. body: { club, password } */
export async function POST(req: Request) {
  return handle(async () => {
    limitLogin(req);
    const body = await readJson(req);
    if (!isClub(body.club)) throw new ApiError(400, "동아리를 골라 주세요.");
    if (!enabledClubs().includes(body.club)) {
      throw new ApiError(503, "이 동아리의 관리자 비밀번호가 아직 설정되지 않았어요. 사이트 관리자에게 알려주세요.");
    }
    if (typeof body.password !== "string" || !checkPassword(body.club, body.password)) {
      throw new ApiError(401, "비밀번호가 맞지 않아요.");
    }
    const session: ddrakSession = { club: body.club, enabled: enabledClubs() };
    return Response.json(session, { headers: { "Set-Cookie": sessionCookie(req, makeToken(body.club)) } });
  });
}

/** 로그아웃 */
export async function DELETE(req: Request) {
  return handle(async () => {
    const session: ddrakSession = { club: null, enabled: enabledClubs() };
    return Response.json(session, { headers: { "Set-Cookie": sessionCookie(req, null) } });
  });
}
