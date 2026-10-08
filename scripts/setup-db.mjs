// Neon 에 src/db/schema.sql 을 적용해요. 여러 번 실행해도 안전해요.
// 실행: npm run db:setup   (.env.local 의 DATABASE_URL_UNPOOLED 또는 DATABASE_URL 사용)
// Vercel 배포 때는 `npm run build` 가 먼저 이걸 실행해서 테이블을 자동으로 맞춰요 (--build).
//
// 앱과 같은 HTTPS(443) 방식으로 연결해요. WebSocket이나 5432 포트를 쓰지 않아서
// 학교·회사 네트워크에서도 잘 막히지 않아요.
import { readFileSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { neon } from "@neondatabase/serverless";
import { splitSql } from "./sql-split.mjs";

const duringBuild = process.argv.includes("--build");

try {
  process.loadEnvFile(".env.local");
} catch {}

const url = (process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || "").trim().replace(/^["']|["']$/g, "");
if (!url && duringBuild) {
  // DB 없이 빌드만 해볼 때(로컬 빌드, DB 연결 안 된 프리뷰)는 건너뛰어요
  console.log("[db:setup] DATABASE_URL 이 없어서 스키마 적용을 건너뛰어요.");
  process.exit(0);
}
if (!url) {
  console.error("DATABASE_URL 이 없어요. 먼저 `npx vercel env pull .env.local` 로 환경변수를 받아오세요.");
  console.error("받았는데도 비어 있다면 Vercel에서 그 변수가 Development 환경에 체크돼 있는지 확인하세요.");
  process.exit(1);
}

let host;
try {
  host = new URL(url).hostname;
} catch {
  console.error("DATABASE_URL 형식이 이상해요. postgresql://... 로 시작하는 주소인지 확인하세요.");
  process.exit(1);
}
console.log(`${duringBuild ? "[db:setup] " : ""}연결 대상: ${host}`);

try {
  await lookup(host);
} catch {
  console.error(`'${host}' 주소를 찾을 수 없어요 (DNS 실패).`);
  console.error("- 인터넷 연결, VPN, 학교·회사 와이파이 차단을 확인하세요. 휴대폰 핫스팟으로 다시 해보면 원인을 가를 수 있어요.");
  console.error("- 또는 Neon 콘솔 → SQL Editor 에 src/db/schema.sql 내용을 붙여넣고 실행해도 돼요.");
  process.exit(1);
}

const sql = neon(url);
const statements = splitSql(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));

try {
  await sql.transaction(statements.map((s) => sql.query(s)));
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM information_schema.tables
                             WHERE table_schema = 'public'
                               AND table_name IN ('members','teams','team_members','availability','member_classes','rehearsals','rehearsal_participants')`;
  console.log(`${duringBuild ? "[db:setup] " : ""}스키마 적용 완료 (테이블 ${n}/7개 확인)`);
} catch (e) {
  console.error("스키마 적용 실패:", e.message);
  if (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|certificate/i.test(String(e.message) + String(e.cause ?? ""))) {
    console.error("네트워크에서 Neon에 닿지 못했어요. 와이파이·VPN을 바꿔 보거나, Neon 콘솔 SQL Editor 에 src/db/schema.sql 을 붙여넣어 실행하세요.");
    if (e.cause) console.error("자세한 원인:", e.cause.message ?? e.cause);
  } else if (/password authentication|role .* does not exist/i.test(e.message)) {
    console.error("접속 정보가 맞지 않아요. `npx vercel env pull .env.local` 로 최신 값을 다시 받아오세요.");
  }
  process.exitCode = 1;
}
