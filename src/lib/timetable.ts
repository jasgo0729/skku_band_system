import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { ApiError } from "./api";
import { parseMinutes, WEEKDAY_NAMES } from "./time";
import type { ClassBlock } from "./types";

// 시간표 사진 → 수업 목록. 들어 있는 API 키에 따라 자동으로 골라요.
//   OPENAI_API_KEY    → OpenAI (먼저 사용)
//   ANTHROPIC_API_KEY → Claude
// TIMETABLE_MODEL 로 모델을 바꿀 수 있어요.

export const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type ImageType = (typeof ALLOWED_TYPES)[number];

type Provider = "openai" | "anthropic";

function provider(): Provider | null {
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return null;
}

const DEFAULT_MODEL: Record<Provider, string> = {
  openai: "gpt-6.1-sol",
  anthropic: "claude-sonnet-5-5",
};

export function hasTimetableKey() {
  return provider() !== null;
}

const PROMPT = `이 이미지는 대학 수업 시간표(에브리타임 같은 주간 표)예요. 표에 있는 수업 블록을 하나도 빠짐없이 알려주세요.

읽는 방법:
- 왼쪽 세로축의 시간 표시(예: 12시, 13시)와 가로 격자선을 기준으로, 각 블록의 위쪽 끝을 시작 시각, 아래쪽 끝을 끝나는 시각으로 계산하세요. 한 시간 칸 안에서 블록이 어디서 시작·끝나는지 비율로 따져서 분 단위까지 구하세요.
- 한국 대학 수업은 보통 50분이나 75분(예: 12:00–13:15, 13:30–14:45, 16:30–17:45)이에요. 계산 결과가 이런 값에 가까우면 그 값으로, 아니면 5분 단위로 반올림하세요.
- 같은 과목이 여러 요일에 있으면 블록마다 따로 적으세요.
- title 에는 과목명만 넣고, 교수 이름이나 강의실 번호는 빼세요.
- weekday 는 월 화 수 목 금 토 일 중 한 글자, start·end 는 24시간제 HH:MM 이에요.
- 시간표가 아니거나 읽을 수 없으면 classes 를 빈 배열로 두고 notes 에 이유를 적으세요. 문제가 없으면 notes 는 빈 문자열이에요.`;

// 두 API에서 같이 쓰는 결과 형식 (OpenAI strict 모드 규칙에 맞춰 모든 필드 필수)
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    classes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          weekday: { type: "string", enum: WEEKDAY_NAMES },
          start: { type: "string", description: "시작 시각 HH:MM" },
          end: { type: "string", description: "끝나는 시각 HH:MM" },
          title: { type: "string", description: "과목명" },
        },
        required: ["weekday", "start", "end", "title"],
      },
    },
    notes: { type: "string", description: "읽기 어려웠던 부분 (없으면 빈 문자열)" },
  },
  required: ["classes", "notes"],
} as const;

type RawResult = {
  classes?: { weekday?: string; start?: string; end?: string; title?: string }[];
  notes?: string;
};

export async function parseTimetable(image: Uint8Array, mediaType: string): Promise<{ classes: ClassBlock[]; notes: string }> {
  if (!ALLOWED_TYPES.includes(mediaType as ImageType)) {
    throw new ApiError(400, "JPG, PNG, WEBP, GIF 이미지만 올릴 수 있어요.");
  }
  const p = provider();
  if (!p) throw new ApiError(503, "시간표 사진 인식용 API 키가 설정되지 않았어요.", { code: "NO_KEY" });

  const base64 = Buffer.from(image).toString("base64");
  const model = process.env.TIMETABLE_MODEL || DEFAULT_MODEL[p];
  const raw = p === "openai" ? await viaOpenAI(model, base64, mediaType) : await viaAnthropic(model, base64, mediaType as ImageType);
  return clean(raw);
}

async function viaOpenAI(model: string, base64: string, mediaType: string): Promise<RawResult> {
  const client = new OpenAI();
  try {
    const res = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mediaType};base64,${base64}`, detail: "high" } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "timetable", strict: true, schema: SCHEMA as unknown as Record<string, unknown> },
      },
    });
    const msg = res.choices[0]?.message;
    if (msg?.refusal) return { classes: [], notes: msg.refusal };
    return JSON.parse(msg?.content || "{}");
  } catch (err) {
    console.error("timetable parse failed (openai)", err);
    if (err instanceof OpenAI.AuthenticationError) throw new ApiError(503, "시간표 인식용 OpenAI API 키가 올바르지 않아요. 관리자에게 알려주세요.");
    if (err instanceof OpenAI.RateLimitError) {
      const quota = (err as { code?: string }).code === "insufficient_quota";
      throw new ApiError(429, quota ? "OpenAI API 크레딧이 부족해서 시간표를 읽지 못했어요. 관리자에게 알려주세요." : "지금 시간표 인식 요청이 많아요. 잠시 후 다시 시도하세요.");
    }
    if (err instanceof OpenAI.NotFoundError) throw new ApiError(503, `시간표 인식 모델(${model})을 쓸 수 없어요. TIMETABLE_MODEL 설정을 확인하세요.`);
    throw new ApiError(502, "시간표를 읽지 못했어요. 잠시 후 다시 시도하거나 직접 입력하세요.");
  }
}

async function viaAnthropic(model: string, base64: string, mediaType: ImageType): Promise<RawResult> {
  const client = new Anthropic();
  try {
    const res = await client.messages.create({
      model,
      max_tokens: 2000,
      tools: [{ name: "report_classes", description: "시간표에서 읽은 수업 블록 목록을 보고해요.", input_schema: SCHEMA as unknown as Anthropic.Tool.InputSchema }],
      tool_choice: { type: "tool", name: "report_classes" },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });
    const block = res.content.find((c) => c.type === "tool_use");
    return (block && block.type === "tool_use" ? block.input : {}) as RawResult;
  } catch (err) {
    console.error("timetable parse failed (anthropic)", err);
    if (err instanceof Anthropic.AuthenticationError) throw new ApiError(503, "시간표 인식용 API 키가 올바르지 않아요. 관리자에게 알려주세요.");
    if (err instanceof Anthropic.RateLimitError) throw new ApiError(429, "지금 시간표 인식 요청이 많아요. 잠시 후 다시 시도하세요.");
    throw new ApiError(502, "시간표를 읽지 못했어요. 잠시 후 다시 시도하거나 직접 입력하세요.");
  }
}

/** 모델 출력은 믿지 않고 한 번 더 검사해요 */
function clean(input: RawResult): { classes: ClassBlock[]; notes: string } {
  const classes: ClassBlock[] = [];
  for (const c of Array.isArray(input.classes) ? input.classes : []) {
    const weekday = WEEKDAY_NAMES.indexOf(String(c?.weekday ?? "").trim().slice(0, 1));
    const startMin = parseMinutes(String(c?.start ?? ""));
    const endMin = parseMinutes(String(c?.end ?? ""));
    if (weekday < 0 || startMin === null || endMin === null || endMin <= startMin) continue;
    classes.push({ weekday, startMin, endMin, title: String(c?.title ?? "").trim().slice(0, 60) });
  }
  classes.sort((a, b) => a.weekday - b.weekday || a.startMin - b.startMin);
  return { classes: classes.slice(0, 60), notes: typeof input.notes === "string" ? input.notes : "" };
}
