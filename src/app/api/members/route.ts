import { connection } from "next/server";
import { getSql } from "@/lib/db";
import { handle, readJson, requireName } from "@/lib/api";
import { listMembers, upsertMember } from "@/lib/queries";

export async function GET() {
  await connection();
  return handle(async () => Response.json(await listMembers(getSql())));
}

/** 이름으로 참여. 같은 이름이 있으면 그 사람으로 들어가요. */
export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson(req);
    const name = requireName(body.name, 30, "이름");
    return Response.json(await upsertMember(getSql(), name), { status: 201 });
  });
}
