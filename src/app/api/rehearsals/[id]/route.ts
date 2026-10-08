import type { NextRequest } from "next/server";
import { getSql, pgCode } from "@/lib/db";
import { ApiError, handle, readJson, requireTimeRange, requireUuid } from "@/lib/api";
import { deleteRehearsal, findConflicts, getRehearsal, updateRehearsal } from "@/lib/queries";

/** 시간 변경 또는 메모 수정. body: { startAt?, endAt?, memo? } */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/rehearsals/[id]">) {
  return handle(async () => {
    const id = requireUuid((await ctx.params).id, "합주");
    const body = await readJson(req);
    const sql = getSql();
    const current = await getRehearsal(sql, id);
    if (!current) throw new ApiError(404, "합주를 찾을 수 없어요. 이미 취소됐을 수 있어요.");

    const changingTime = body.startAt !== undefined || body.endAt !== undefined;
    const time = changingTime
      ? requireTimeRange(body.startAt ?? current.startAt, body.endAt ?? current.endAt)
      : null;
    const memo =
      body.memo === undefined ? undefined : typeof body.memo === "string" && body.memo.trim() ? body.memo.trim().slice(0, 200) : null;

    try {
      await updateRehearsal(sql, id, { startAt: time?.startAt, endAt: time?.endAt, memo });
    } catch (err) {
      if (pgCode(err) !== "23P01" || !time) throw err;
      const conflicts = await findConflicts(sql, current.participants.map((m) => m.id), time.startAt, time.endAt, id);
      throw new ApiError(409, "바꾸려는 시간에 다른 합주가 있는 팀원이 있어요.", { conflicts });
    }
    return Response.json(await getRehearsal(sql, id));
  });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/rehearsals/[id]">) {
  return handle(async () => {
    const id = requireUuid((await ctx.params).id, "합주");
    await deleteRehearsal(getSql(), id);
    return Response.json({ ok: true });
  });
}
