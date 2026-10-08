"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RequireMe, useMe } from "@/components/AppShell";
import { ClassEditor, TimetablePanel } from "@/components/Timetable";
import { WeekGrid, WeekNav, assignLanes, type CellPos, type GridBlock } from "@/components/WeekGrid";
import { useRefresh, useWeek } from "@/components/useWeek";
import { buildClassIndex } from "@/lib/classes";
import { api, describeError } from "@/lib/client";
import { addDays, minutesLabel, minutesToSlots, spanOnGrid, weekdayIndex, type Day } from "@/lib/time";
import type { ClassBlock, DaySlots, Rehearsal, Team } from "@/lib/types";

type Paint = { anchor: CellPos; cur: CellPos; add: boolean };

function inRect(p: Paint, d: number, i: number) {
  return (
    d >= Math.min(p.anchor.d, p.cur.d) &&
    d <= Math.max(p.anchor.d, p.cur.d) &&
    i >= Math.min(p.anchor.i, p.cur.i) &&
    i <= Math.max(p.anchor.i, p.cur.i)
  );
}

export default function Page() {
  return (
    <RequireMe>
      <MyTimePage />
    </RequireMe>
  );
}

function MyTimePage() {
  const { me } = useMe();
  const week = useWeek();
  const { days, from, to } = week;
  const [avail, setAvail] = useState<DaySlots>({});
  const [loaded, setLoaded] = useState(false);
  const [rehearsals, setRehearsals] = useState<Rehearsal[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [paint, setPaint] = useState<Paint | null>(null);
  const [tapAnchor, setTapAnchor] = useState<CellPos | null>(null);
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "saved" | "error"; text?: string }>({ kind: "idle" });
  const weekKey = useRef(from);
  const [classes, setClasses] = useState<ClassBlock[]>([]);
  const [draft, setDraft] = useState<{ classes: ClassBlock[]; notes: string; fromPhoto: boolean } | null>(null);
  const classAt = useMemo(() => buildClassIndex(classes), [classes]);

  const loadRehearsals = useCallback(() => {
    api<Rehearsal[]>(`/api/rehearsals?from=${from}&to=${to}&member=${me.id}`).then(setRehearsals).catch(() => {});
  }, [from, to, me.id]);

  useEffect(() => {
    weekKey.current = from;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoaded(false);
    setTapAnchor(null);
    api<DaySlots>(`/api/availability?member=${me.id}&from=${from}&to=${to}`)
      .then((a) => {
        if (weekKey.current !== from) return;
        setAvail(a);
        setLoaded(true);
      })
      .catch((e) => setStatus({ kind: "error", text: describeError(e) }));
    loadRehearsals();
  }, [from, to, me.id, loadRehearsals]);

  useEffect(() => {
    api<ClassBlock[]>(`/api/classes?member=${me.id}`).then(setClasses).catch(() => {});
  }, [me.id]);

  useEffect(() => {
    api<Team[]>("/api/teams")
      .then((all) => setTeams(all.filter((t) => t.members.some((m) => m.id === me.id))))
      .catch(() => {});
  }, [me.id]);

  useRefresh(loadRehearsals, 60000);

  const has = useCallback((day: Day, i: number) => (avail[day] ?? []).includes(i), [avail]);

  async function save(changed: DaySlots) {
    setStatus({ kind: "saving" });
    try {
      await api("/api/availability", { method: "PUT", json: { memberId: me.id, days: changed } });
      setStatus({ kind: "saved" });
    } catch (e) {
      setStatus({ kind: "error", text: describeError(e) });
    }
  }

  function finishPaint() {
    if (!paint) return;
    setPaint(null);
    applyPaint(paint);
  }

  function applyPaint(p: Paint) {
    const next = { ...avail };
    const changed: DaySlots = {};
    for (let d = Math.min(p.anchor.d, p.cur.d); d <= Math.max(p.anchor.d, p.cur.d); d++) {
      const day = days[d];
      const set = new Set(next[day] ?? []);
      for (let i = Math.min(p.anchor.i, p.cur.i); i <= Math.max(p.anchor.i, p.cur.i); i++) {
        if (p.add) set.add(i);
        else set.delete(i);
      }
      next[day] = [...set].sort((a, b) => a - b);
      changed[day] = next[day];
    }
    setAvail(next);
    save(changed);
  }

  async function copyLastWeek() {
    const hasAny = days.some((d) => (avail[d] ?? []).length > 0);
    if (hasAny && !window.confirm("이번 주에 칠한 시간을 지난주 내용으로 바꿀까요?")) return;
    try {
      const prev = await api<DaySlots>(`/api/availability?member=${me.id}&from=${addDays(from, -7)}&to=${from}`);
      const next: DaySlots = {};
      for (const day of days) next[day] = prev[addDays(day, -7)] ?? [];
      setAvail(next);
      await save(next);
    } catch (e) {
      setStatus({ kind: "error", text: describeError(e) });
    }
  }

  const blocks: GridBlock[] = useMemo(() => {
    // 수업: 매주 같은 요일에 회색 블록으로
    const classBlocks: GridBlock[] = [];
    days.forEach((day, d) => {
      const wd = weekdayIndex(day);
      classes
        .filter((c) => c.weekday === wd)
        .forEach((c, k) => {
          const { start, end } = minutesToSlots(c.startMin, c.endMin);
          classBlocks.push({
            key: `class-${d}-${k}`,
            d,
            start,
            end,
            variant: "class",
            title: c.title || "수업",
            sub: `${minutesLabel(c.startMin)}–${minutesLabel(c.endMin)}`,
          });
        });
    });
    const spans = rehearsals
      .map((r) => {
        const s = spanOnGrid(r.startAt, r.endAt, days);
        return s ? { ...s, r } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    const rehearsalBlocks: GridBlock[] = assignLanes(spans).map((s) => ({
      key: s.r.id,
      d: s.d,
      start: s.start,
      end: s.end,
      lane: s.lane,
      lanes: s.lanes,
      title: s.r.teamName,
      sub: "합주",
    }));
    return [...classBlocks, ...rehearsalBlocks];
  }, [rehearsals, days, classes]);

  const filledCount = days.reduce((n, d) => n + (avail[d]?.length ?? 0), 0);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">내 가능 시간</h1>
          <p className="muted">
            합주할 수 있는 시간을 드래그해서 칠하세요. 휴대폰에서는 시작 칸과 끝 칸을 차례로 누르면 그 사이가 칠해져요. 여기서 한 번 칠하면 내가 속한 모든 팀 화면에 같이 쓰여요.
          </p>
        </div>
      </div>

      <div className="toolbar">
        <WeekNav label={week.label} onPrev={week.prev} onNext={week.next} onToday={week.thisWeek} />
        <div className="toolbar-right">
          <span className={`save-status save-${status.kind}`} role="status">
            {status.kind === "saving" && "저장 중"}
            {status.kind === "saved" && "저장됨"}
            {status.kind === "error" && status.text}
          </span>
          <button className="btn" onClick={copyLastWeek} disabled={!loaded}>
            지난주 시간 가져오기
          </button>
        </div>
      </div>

      {draft && (
        <ClassEditor
          key={`${draft.fromPhoto}-${draft.classes.length}-${draft.notes}`}
          memberId={me.id}
          initial={draft.classes}
          notes={draft.notes}
          fromPhoto={draft.fromPhoto}
          onSaved={(c) => {
            setClasses(c);
            setDraft(null);
          }}
          onCancel={() => setDraft(null)}
        />
      )}

      <div className="layout-split">
        <div className="grid-wrap" aria-busy={!loaded}>
          <WeekGrid
            days={days}
            cellClass={(d, i) => {
              const on = paint && inRect(paint, d, i) ? paint.add : has(days[d], i);
              // 수업 시간은 칠해 둬도 불가로 계산돼요
              return on && !classAt(weekdayIndex(days[d]), i) ? "cell-mine" : "";
            }}
            blocks={blocks}
            onDragStart={(p) => loaded && setPaint({ anchor: p, cur: p, add: !has(days[p.d], p.i) })}
            onDragMove={(p) => setPaint((cur) => (cur ? { ...cur, cur: p } : cur))}
            onDragEnd={finishPaint}
            pending={tapAnchor}
            onTap={(p) => {
              if (!loaded) return;
              if (!tapAnchor) return setTapAnchor(p);
              applyPaint({ anchor: tapAnchor, cur: p, add: !has(days[tapAnchor.d], tapAnchor.i) });
              setTapAnchor(null);
            }}
          />
          <div className="legend">
            <span className="legend-item">
              <i className="swatch swatch-mine" /> 가능
            </span>
            <span className="legend-item">
              <i className="swatch swatch-tape" /> 확정된 합주
            </span>
            <span className="legend-item">
              <i className="swatch swatch-class" /> 수업 (자동으로 불가)
            </span>
            {loaded && filledCount === 0 && <span className="legend-hint">이번 주는 아직 비어 있어요. 가능한 칸을 칠해 주세요.</span>}
          </div>
        </div>

        <aside className="side">
          <TimetablePanel
            memberId={me.id}
            classes={classes}
            onDraft={(c, notes, fromPhoto) => setDraft({ classes: c, notes, fromPhoto })}
            onClear={async () => {
              try {
                setClasses(await api<ClassBlock[]>("/api/classes", { method: "PUT", json: { memberId: me.id, classes: [] } }));
              } catch (e) {
                setStatus({ kind: "error", text: describeError(e) });
              }
            }}
          />
          <section className="panel">
            <h2 className="panel-title">내 팀</h2>
            {teams.length === 0 ? (
              <p className="muted">
                아직 속한 팀이 없어요. <Link href="/teams">팀 화면</Link>에서 팀을 만들거나 들어가세요.
              </p>
            ) : (
              <ul className="link-list">
                {teams.map((t) => (
                  <li key={t.id}>
                    <Link href={`/teams/${t.id}`}>{t.name}</Link>
                    <span className="muted"> {t.members.length}명</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <CalendarSubscribe memberId={me.id} />
        </aside>
      </div>
    </div>
  );
}

function CalendarSubscribe({ memberId }: { memberId: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window === "undefined" ? "" : `${window.location.origin}/api/ical/${memberId}.ics`;
  const webcal = url.replace(/^https?:/, "webcal:");

  return (
    <section className="panel">
      <h2 className="panel-title">폰 캘린더에 연결</h2>
      <p className="muted">
        한 번만 추가하면 내 합주가 잡히거나 바뀔 때 폰 캘린더에도 따라와요. 반영까지 몇 시간 걸릴 수 있어요.
      </p>
      <input className="input input-mono" readOnly value={url} aria-label="캘린더 구독 주소" onFocus={(e) => e.target.select()} />
      <div className="row">
        <button
          className="btn"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {}
          }}
        >
          {copied ? "복사됨" : "주소 복사"}
        </button>
        <a className="btn" href={webcal}>
          애플 캘린더에 추가
        </a>
      </div>
      <p className="fine">구글 캘린더: 다른 캘린더 옆 + → URL로 추가 → 위 주소 붙여넣기</p>
    </section>
  );
}
