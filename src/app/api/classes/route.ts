import { getSql } from "@/lib/db";
import { ApiError, handle, normalizeClasses, readJson, requireUuid } from "@/lib/api";
import { getMember, listClasses, replaceClasses } from "@/lib/queries";

/** ?member= — 그 사람의 수업 시간표 */
export async function GET(req: Request) {
  return handle(async () => {
    const memberId = requireUuid(new URL(req.url).searchParams.get("member"), "멤버");
    const all = await listClasses(getSql(), [memberId]);
    return Response.json(all[memberId] ?? []);
  });
}

/** body: { memberId, classes: [{ weekday, startMin, endMin, title }] } — 통째로 바꿔요 */
export async function PUT(req: Request) {
  return handle(async () => {
    const body = await readJson(req);
    const memberId = requireUuid(body.memberId, "멤버");
    const classes = normalizeClasses(body.classes);
    const sql = getSql();
    if (!(await getMember(sql, memberId))) throw new ApiError(404, "멤버를 찾을 수 없어요.");
    await replaceClasses(sql, memberId, classes);
    return Response.json((await listClasses(sql, [memberId]))[memberId] ?? []);
  });
}
