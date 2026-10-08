import { rangeLabel } from "./time";
import type { Rehearsal } from "./types";

const enc = new TextEncoder();

function escapeText(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** iCalendar 규칙: 한 줄 75바이트 넘으면 접기 (한글은 3바이트라 글자 단위로 끊어요) */
function fold(line: string): string {
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > (out.length === 0 ? 75 : 74)) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

function stamp(iso: string | Date) {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function buildIcs(calName: string, rehearsals: Rehearsal[], host: string): string {
  const now = stamp(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//band-sync//합주표//KO",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calName)}`,
    "X-WR-TIMEZONE:Asia/Seoul",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const r of rehearsals) {
    const who = r.participants.map((p) => p.name).join(", ");
    const desc = [`${rangeLabel(r.startAt, r.endAt)}`, `참여: ${who}`, r.memo ? `메모: ${r.memo}` : ""]
      .filter(Boolean)
      .join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${r.id}@band-sync`,
      `DTSTAMP:${now}`,
      `DTSTART:${stamp(r.startAt)}`,
      `DTEND:${stamp(r.endAt)}`,
      `SUMMARY:${escapeText(`${r.teamName} 합주`)}`,
      `DESCRIPTION:${escapeText(desc)}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
