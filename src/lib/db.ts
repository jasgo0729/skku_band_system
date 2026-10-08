import { neon } from "@neondatabase/serverless";

/**
 * 태그드 템플릿으로 쿼리를 실행하고 행 배열을 돌려주는 함수.
 * 배포에서는 Neon HTTP 드라이버, 로컬 개발(npm run dev:local)과 테스트에서는 PGlite를 같은 모양으로 감싸요.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<any[]>;

const g = globalThis as unknown as { __bandSyncSql?: Sql };

export function getSql(): Sql {
  if (g.__bandSyncSql) return g.__bandSyncSql;

  // Neon 없이 내 컴퓨터에서만 돌려볼 때: npm run dev:local (.pglite 폴더에 저장)
  if (process.env.PGLITE_DIR && (process.env.NODE_ENV !== "production" || process.env.ALLOW_PGLITE === "1")) {
    g.__bandSyncSql = localSql(process.env.PGLITE_DIR!);
    return g.__bandSyncSql;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL 환경변수가 없어요. .env.local 또는 Vercel 환경변수를 확인하세요.");
  }
  g.__bandSyncSql = neon(url) as unknown as Sql;
  return g.__bandSyncSql;
}

function localSql(dir: string): Sql {
  const ready = (async () => {
    const [{ PGlite }, { btree_gist }, fs, path] = await Promise.all([
      import("@electric-sql/pglite"),
      import("@electric-sql/pglite/contrib/btree_gist"),
      import("node:fs"),
      import("node:path"),
    ]);
    const db = await PGlite.create(dir, { extensions: { btree_gist } });
    await db.exec(fs.readFileSync(path.join(process.cwd(), "src/db/schema.sql"), "utf8"));
    return db;
  })();
  return async (strings, ...values) => (await (await ready).sql(strings, ...values)).rows as never[];
}

/** Postgres 에러 코드 (exclusion 위반 = 23P01, unique 위반 = 23505) */
export function pgCode(err: unknown): string | undefined {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}
