import { getSql } from "@/lib/db";
import { ApiError, handle, requireUuid } from "@/lib/api";
import { getMember } from "@/lib/queries";
import { hasTimetableKey, parseTimetable } from "@/lib/timetable";

const MAX_BYTES = 4 * 1024 * 1024; // Vercel 함수 요청 크기 제한(4.5MB) 안쪽

// 로그인이 없어서 남이 마구 호출하지 못하게 아주 단순한 횟수 제한을 둬요 (서버 인스턴스별)
const hits = new Map<string, number[]>();
function rateLimit(key: string, limit = 8, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) throw new ApiError(429, "시간표 인식은 10분에 8번까지 할 수 있어요. 잠시 후 다시 시도하세요.");
  recent.push(now);
  hits.set(key, recent);
}

/** multipart/form-data: memberId, image — 저장하지 않고 읽은 결과만 돌려줘요 (확인 후 PUT /api/classes) */
export async function POST(req: Request) {
  return handle(async () => {
    if (!hasTimetableKey()) {
      throw new ApiError(503, "시간표 사진 인식이 아직 설정되지 않았어요. 직접 입력하거나 관리자에게 API 키 설정을 부탁하세요.", {
        code: "NO_KEY",
      });
    }
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new ApiError(400, "이미지를 받지 못했어요. 다시 올려 주세요.");
    }
    const memberId = requireUuid(form.get("memberId"), "멤버");
    const file = form.get("image");
    if (!(file instanceof File)) throw new ApiError(400, "이미지를 받지 못했어요. 다시 올려 주세요.");
    if (file.size > MAX_BYTES) throw new ApiError(413, "이미지가 너무 커요. 4MB 이하로 올려 주세요.");
    if (!(await getMember(getSql(), memberId))) throw new ApiError(404, "멤버를 찾을 수 없어요.");

    rateLimit(`${memberId}|${req.headers.get("x-forwarded-for")?.split(",")[0] ?? ""}`);
    const result = await parseTimetable(new Uint8Array(await file.arrayBuffer()), file.type);
    return Response.json(result);
  });
}
