"use client";

import { useRef, useState } from "react";
import { api, describeError, RequestError } from "@/lib/client";
import { minutesLabel, parseMinutes, WEEKDAY_NAMES } from "@/lib/time";
import type { ClassBlock } from "@/lib/types";

/** 큰 사진은 줄여서 보내요 (요청 크기 제한 · 인식 속도) */
async function shrink(file: File): Promise<Blob> {
  const okType = ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type);
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    if (scale === 1 && okType && file.size < 3.5 * 1024 * 1024) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), "image/jpeg", 0.92));
  } catch {
    return file; // 브라우저가 못 여는 형식이면 그대로 보내고 서버가 안내해요
  }
}

export function classLabel(c: ClassBlock) {
  return `${WEEKDAY_NAMES[c.weekday]} ${minutesLabel(c.startMin)}–${minutesLabel(c.endMin)}`;
}

/** 옆 패널: 시간표 사진 올리기 · 저장된 수업 보기 */
export function TimetablePanel(p: {
  memberId: string;
  classes: ClassBlock[];
  onDraft: (draft: ClassBlock[], notes: string, fromPhoto: boolean) => void;
  onClear: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError("");
    setReading(true);
    try {
      const form = new FormData();
      form.set("memberId", p.memberId);
      const blob = await shrink(file);
      form.set("image", blob, blob === file ? file.name : "timetable.jpg");
      const res = await fetch("/api/timetable/parse", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new RequestError(data.error ?? "시간표를 읽지 못했어요.", res.status);
      if ((data.classes ?? []).length === 0) {
        setError(data.notes ? `수업을 찾지 못했어요. ${data.notes}` : "수업을 찾지 못했어요. 시간표 전체가 보이게 캡처해서 다시 올리거나 직접 입력하세요.");
        return;
      }
      p.onDraft(data.classes, data.notes ?? "", true);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <section className="panel">
      <h2 className="panel-title">수업 시간표</h2>
      {p.classes.length === 0 ? (
        <p className="muted">시간표 캡처를 올리면 수업 시간이 매주 자동으로 불가로 빠져요. 칠할 필요가 없어요.</p>
      ) : (
        <ul className="class-list">
          {p.classes.map((c, i) => (
            <li key={i}>
              <span className="class-when">{classLabel(c)}</span>
              <span className="class-title">{c.title || "수업"}</span>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      {reading && <p className="muted" role="status">시간표를 읽는 중이에요. 10초쯤 걸려요.</p>}
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="btn" onClick={() => fileRef.current?.click()} disabled={reading}>
          {p.classes.length ? "사진으로 다시 불러오기" : "사진으로 불러오기"}
        </button>
        <button className="btn btn-quiet" onClick={() => p.onDraft(p.classes, "", false)} disabled={reading}>
          {p.classes.length ? "수정" : "직접 입력"}
        </button>
        {p.classes.length > 0 && (
          <button
            className="btn btn-quiet btn-danger-text"
            onClick={() => window.confirm("수업 시간표를 모두 지울까요? 학기가 끝났을 때 쓰세요.") && p.onClear()}
          >
            모두 지우기
          </button>
        )}
      </div>
    </section>
  );
}

type Row = { weekday: number; start: string; end: string; title: string };

const toRow = (c: ClassBlock): Row => ({
  weekday: c.weekday,
  start: minutesLabel(c.startMin),
  end: minutesLabel(Math.min(c.endMin, 1439)),
  title: c.title,
});

/** 인식 결과 확인 · 수정 후 저장 */
export function ClassEditor(p: {
  memberId: string;
  initial: ClassBlock[];
  notes: string;
  fromPhoto: boolean;
  onSaved: (classes: ClassBlock[]) => void;
  onCancel: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => (p.initial.length ? p.initial.map(toRow) : [{ weekday: 0, start: "09:00", end: "10:15", title: "" }]));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  async function save() {
    setError("");
    const classes: ClassBlock[] = [];
    for (const [i, r] of rows.entries()) {
      const startMin = parseMinutes(r.start);
      const endMin = parseMinutes(r.end);
      if (startMin === null || endMin === null || endMin <= startMin) {
        setError(`${i + 1}번째 줄: 끝나는 시간이 시작보다 늦어야 해요.`);
        return;
      }
      classes.push({ weekday: r.weekday, startMin, endMin, title: r.title.trim() });
    }
    setBusy(true);
    try {
      p.onSaved(await api<ClassBlock[]>("/api/classes", { method: "PUT", json: { memberId: p.memberId, classes } }));
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  }

  return (
    <section className="panel editor" aria-label="수업 시간표 편집">
      <div className="editor-head">
        <h2 className="panel-title">
          {p.fromPhoto ? `사진에서 수업 ${p.initial.length}개를 읽었어요` : "수업 시간표"}
        </h2>
        <p className="muted">
          {p.fromPhoto
            ? "시간이 맞는지 한 번 확인하고 저장하세요. 틀린 곳은 바로 고칠 수 있어요."
            : "매주 반복되는 수업을 적어 두면 그 시간은 모든 팀 화면에서 자동으로 불가로 계산돼요."}
        </p>
        {p.notes && <p className="fine">인식 메모: {p.notes}</p>}
      </div>

      <div className="class-rows">
        {rows.map((r, i) => (
          <div className="class-row" key={i}>
            <select className="input" value={r.weekday} onChange={(e) => update(i, { weekday: Number(e.target.value) })} aria-label="요일">
              {WEEKDAY_NAMES.map((n, k) => (
                <option key={n} value={k}>
                  {n}
                </option>
              ))}
            </select>
            <input className="input" type="time" step={300} value={r.start} onChange={(e) => update(i, { start: e.target.value })} aria-label="시작" />
            <span className="class-dash">–</span>
            <input className="input" type="time" step={300} value={r.end} onChange={(e) => update(i, { end: e.target.value })} aria-label="끝" />
            <input className="input class-row-title" value={r.title} onChange={(e) => update(i, { title: e.target.value })} placeholder="과목명" maxLength={60} aria-label="과목명" />
            <button className="btn btn-quiet" onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))} aria-label={`${i + 1}번째 수업 삭제`}>
              삭제
            </button>
          </div>
        ))}
      </div>

      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="btn" onClick={() => setRows((rs) => [...rs, { ...(rs.at(-1) ?? { weekday: 0, start: "09:00", end: "10:15" }), title: "" }])}>
          수업 추가
        </button>
        <span className="row-spacer" />
        <button className="btn btn-quiet" onClick={p.onCancel}>
          취소
        </button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>
          시간표 저장
        </button>
      </div>
    </section>
  );
}
