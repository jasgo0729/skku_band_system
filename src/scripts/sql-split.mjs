// db/schema.sql 을 문장 단위로 나눠요. HTTP 드라이버는 한 번에 한 문장만 받기 때문이에요.
// $$ ... $$ 블록(함수, DO 블록) 안의 세미콜론은 문장 끝으로 보지 않아요.
export function splitSql(text) {
  const out = [];
  let cur = [];
  let inDollar = false;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!inDollar && (trimmed === "" || trimmed.startsWith("--"))) continue;
    cur.push(line);
    const dollars = (line.match(/\$\$/g) ?? []).length;
    if (dollars % 2 === 1) inDollar = !inDollar;
    if (!inDollar && trimmed.endsWith(";")) {
      out.push(cur.join("\n").trim().replace(/;$/, ""));
      cur = [];
    }
  }
  if (cur.join("").trim()) out.push(cur.join("\n").trim());
  return out;
}
