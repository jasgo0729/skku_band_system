"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RequireMe, useMe } from "@/components/AppShell";
import { MemberPicker } from "@/components/MemberPicker";
import { WeekGrid, WeekNav, type CellPos, type GridBlock } from "@/components/WeekGrid";
import { useRefresh, useWeek } from "@/components/useWeek";
import { buildClassIndex, type ClassIndex } from "@/lib/classes";
import { api, describeError } from "@/lib/client";
import { weekdayIndex, dayLabel, GRID_END_SLOT, GRID_FIRST_SLOT, rangeLabel, slotLabel, slotToIso, spanOnGrid, type Day } from "@/lib/time";
import type { Member, Rehearsal, Team, TeamGrid } from "@/lib/types";

type Sel = { d: number; start: number; end: number }; // end는 포함 안 함
type Status = { kind: "ok" } | { kind: "no" } | { kind: "class"; titles: string[] } | { kind: "busy"; teams: string[] };

const MIN_SUGGEST_SLOTS = 2; // 1시간 이상 모두 되는 시간만 추천

export default function Page() {
  return (
    <RequireMe>
      <TeamPage />
    </RequireMe>
  );
}

function TeamPage() {
  const { id } = useParams<{ id: string }>();
  const { me } = useMe();
  const router = useRouter();
  const week = useWeek();
  const { days, from, to } = week;

  const [grid, setGrid] = useState<TeamGrid | null>(null);
  const [loadError, setLoadError] = useState("");
  const [sel, setSel] = useState<Sel | null>(null);
  const [anchor, setAnchor] = useState<CellPos | null>(null);
  const [tapAnchor, setTapAnchor] = useState<CellPos | null>(null);
  const [hover, setHover] = useState<CellPos | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [memo, setMemo] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const reqKey = useRef("");

  const load = useCallback(() => {
    const key = `${id}|${from}`;
    reqKey.current = key;
    api<TeamGrid>(`/api/teams/${id}/grid?from=${from}&to=${to}`)
      .then((g) => {
        if (reqKey.current === key) {
          setGrid(g);
          setLoadError("");
        }
      })
      .catch((e) => setLoadError(describeError(e)));
  }, [id, from, to]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSel(null);
    setTapAnchor(null);
    setPickedId(null);
  }, [load]);
  useRefresh(load);

  const members = useMemo(() => grid?.team.members ?? [], [grid]);
  const total = members.length;

  // 멤버·날짜·칸 → 다른 팀 합주 이름들
  const busyMap = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const b of grid?.busy ?? []) {
      const s = spanOnGrid(b.startAt, b.endAt, days);
      if (!s) continue;
      for (let i = s.start; i < s.end; i++) {
        const k = `${b.memberId}|${s.d}|${i}`;
        m.set(k, [...(m.get(k) ?? []), b.teamName]);
      }
    }
    return m;
  }, [grid, days]);

  // 멤버별 수업 시간표 (매주 반복) — 이 시간은 칠해 뒀어도 불가로 계산해요
  const classIdx = useMemo(() => {
    const m = new Map<string, ClassIndex>();
    for (const [memberId, list] of Object.entries(grid?.classes ?? {})) m.set(memberId, buildClassIndex(list));
    return m;
  }, [grid]);
  const weekdays = useMemo(() => days.map(weekdayIndex), [days]);

  const statusOf = useCallback(
    (memberId: string, d: number, i: number): Status => {
      const teams = busyMap.get(`${memberId}|${d}|${i}`);
      if (teams) return { kind: "busy", teams };
      const titles = classIdx.get(memberId)?.(weekdays[d], i);
      if (titles) return { kind: "class", titles };
      return (grid?.availability[memberId]?.[days[d]] ?? []).includes(i) ? { kind: "ok" } : { kind: "no" };
    },
    [busyMap, classIdx, weekdays, grid, days],
  );

  // 이미 지난 칸은 흐리게, 고를 수 없게
  const [now, setNow] = useState(() => Date.now());
  useRefresh(useCallback(() => setNow(Date.now()), []), 60000);
  const isPast = useCallback((d: number, i: number) => new Date(slotToIso(days[d], i + 1)).getTime() <= now, [days, now]);

  // 칸마다 가능 인원 · 막힌 인원
  const cells = useMemo(() => {
    const out = new Map<string, { ok: number; busy: number }>();
    for (let d = 0; d < 7; d++) {
      for (let i = GRID_FIRST_SLOT; i < GRID_END_SLOT; i++) {
        let ok = 0;
        let b = 0;
        for (const m of members) {
          const s = statusOf(m.id, d, i);
          if (s.kind === "ok") ok++;
          else if (s.kind === "busy") b++;
        }
        out.set(`${d}|${i}`, { ok, busy: b });
      }
    }
    return out;
  }, [members, statusOf]);

  // 이 팀 합주가 이미 있는 칸
  const ownTaken = useMemo(() => {
    const set = new Set<string>();
    for (const r of grid?.rehearsals ?? []) {
      if (r.id === movingId) continue;
      const s = spanOnGrid(r.startAt, r.endAt, days);
      if (s) for (let i = s.start; i < s.end; i++) set.add(`${s.d}|${i}`);
    }
    return set;
  }, [grid, days, movingId]);

  // 팀원 전원이 되는 연속 구간 (1시간 이상)
  const suggestions = useMemo(() => {
    if (total === 0) return [] as Sel[];
    const out: Sel[] = [];
    for (let d = 0; d < 7; d++) {
      let start = -1;
      for (let i = GRID_FIRST_SLOT; i <= GRID_END_SLOT; i++) {
        const full =
          i < GRID_END_SLOT && !isPast(d, i) && cells.get(`${d}|${i}`)?.ok === total && !ownTaken.has(`${d}|${i}`);
        if (full && start < 0) start = i;
        if (!full && start >= 0) {
          if (i - start >= MIN_SUGGEST_SLOTS) out.push({ d, start, end: i });
          start = -1;
        }
      }
    }
    return out;
  }, [cells, total, ownTaken, isPast]);

  const picked = grid?.rehearsals.find((r) => r.id === pickedId) ?? null;
  const moving = grid?.rehearsals.find((r) => r.id === movingId) ?? null;

  const blocks: GridBlock[] = (grid?.rehearsals ?? [])
    .map((r) => {
      const s = spanOnGrid(r.startAt, r.endAt, days);
      if (!s) return null;
      return {
        key: r.id,
        ...s,
        title: "합주",
        sub: r.memo ?? undefined,
        tone: 0,
        active: r.id === pickedId,
        dim: r.id === movingId,
        onClick: () => {
          setSel(null);
          setError("");
          setPickedId(r.id);
        },
      } satisfies GridBlock;
    })
    .filter((b): b is NonNullable<typeof b> => b !== null);

  function rangeStatus(s: Sel) {
    const ok: Member[] = [];
    const no: Member[] = [];
    const blocked: { m: Member; teams: string[] }[] = [];
    const inClass: { m: Member; titles: string[] }[] = [];
    for (const m of members) {
      const sts = Array.from({ length: s.end - s.start }, (_, k) => statusOf(m.id, s.d, s.start + k));
      const busyTeams = [...new Set(sts.flatMap((x) => (x.kind === "busy" ? x.teams : [])))];
      const titles = [...new Set(sts.flatMap((x) => (x.kind === "class" ? x.titles : [])))];
      if (busyTeams.length) blocked.push({ m, teams: busyTeams });
      else if (titles.length) inClass.push({ m, titles });
      else if (sts.every((x) => x.kind === "ok")) ok.push(m);
      else no.push(m);
    }
    return { ok, no, blocked, inClass };
  }

  async function confirm() {
    if (!sel) return;
    setBusy(true);
    setError("");
    const startAt = slotToIso(days[sel.d], sel.start);
    const endAt = slotToIso(days[sel.d], sel.end);
    try {
      if (moving) {
        await api<Rehearsal>(`/api/rehearsals/${moving.id}`, { method: "PATCH", json: { startAt, endAt } });
        setPickedId(moving.id);
        setMovingId(null);
      } else {
        const r = await api<Rehearsal>("/api/rehearsals", {
          method: "POST",
          json: { teamId: id, startAt, endAt, memo, createdBy: me.name },
        });
        setPickedId(r.id);
        setMemo("");
      }
      setSel(null);
      setTapAnchor(null);
      load();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function cancelRehearsal(r: Rehearsal) {
    if (!window.confirm(`${rangeLabel(r.startAt, r.endAt)} 합주를 취소할까요? 팀원 모두의 캘린더에서 빠져요.`)) return;
    setBusy(true);
    try {
      await api(`/api/rehearsals/${r.id}`, { method: "DELETE" });
      setPickedId(null);
      load();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  if (loadError && !grid) {
    return (
      <div className="page page-narrow">
        <p className="error">{loadError}</p>
        <Link href="/teams">팀 목록으로</Link>
      </div>
    );
  }
  if (!grid) return <div className="page"><p className="muted">불러오는 중</p></div>;

  const hoverCell = hover && !sel ? cells.get(`${hover.d}|${hover.i}`) : null;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="crumb">
            <Link href="/teams">팀</Link>
          </p>
          <h1 className="page-title">{grid.team.name}</h1>
          <p className="muted">
            진할수록 많은 팀원이 가능해요. 수업 시간은 자동으로 불가로 계산되고, 빗금 친 칸은 누군가 다른 팀 합주가 있는 시간이에요. 원하는 시간을 위아래로 드래그해서 합주를 잡으세요.
          </p>
        </div>
      </div>

      <div className="toolbar">
        <WeekNav label={week.label} onPrev={week.prev} onNext={week.next} onToday={week.thisWeek} />
        <HeatLegend total={total} />
      </div>

      {moving && (
        <div className="banner" role="status">
          <span>
            <strong>{rangeLabel(moving.startAt, moving.endAt)}</strong> 합주를 옮길 새 시간을 드래그해서 고르세요.
          </span>
          <button
            className="btn btn-quiet"
            onClick={() => {
              setMovingId(null);
              setSel(null);
            }}
          >
            옮기기 그만두기
          </button>
        </div>
      )}

      <div className="layout-split">
        <div className="grid-wrap">
          <WeekGrid
            days={days}
            cellClass={(d, i) => {
              const c = cells.get(`${d}|${i}`)!;
              const level = total === 0 ? 0 : c.ok === total ? 6 : Math.ceil((c.ok / total) * 5);
              const selected = sel && sel.d === d && i >= sel.start && i < sel.end;
              const selCls = selected
                ? `cell-selected ${i === sel.start ? "sel-top" : ""} ${i === sel.end - 1 ? "sel-bottom" : ""}`
                : "";
              return `heat-${level} ${c.busy ? "cell-busy" : ""} ${isPast(d, i) ? "cell-past" : ""} ${selCls}`;
            }}
            cellLabel={(d, i) => {
              const c = cells.get(`${d}|${i}`)!;
              return `${dayLabel(days[d])} ${slotLabel(i)} · ${c.ok}/${total}명 가능${c.busy ? ` · ${c.busy}명 다른 합주` : ""}`;
            }}
            blocks={blocks}
            onDragStart={(p) => {
              if (isPast(p.d, p.i)) return;
              setPickedId(null);
              setError("");
              setAnchor(p);
              setSel({ d: p.d, start: p.i, end: p.i + 1 });
            }}
            onDragMove={(p) => {
              if (!anchor) return;
              // 지난 시간 쪽으로는 늘어나지 않게
              let i = p.i;
              while (i < anchor.i && isPast(anchor.d, i)) i++;
              setSel({ d: anchor.d, start: Math.min(anchor.i, i), end: Math.max(anchor.i, i) + 1 });
            }}
            onDragEnd={() => setAnchor(null)}
            onHover={setHover}
            pending={tapAnchor}
            onTap={(p) => {
              if (isPast(p.d, p.i)) return;
              setPickedId(null);
              setError("");
              if (tapAnchor && tapAnchor.d === p.d) {
                setSel({ d: p.d, start: Math.min(tapAnchor.i, p.i), end: Math.max(tapAnchor.i, p.i) + 1 });
                setTapAnchor(null);
              } else {
                setSel({ d: p.d, start: p.i, end: p.i + 1 });
                setTapAnchor(p);
              }
            }}
          />
        </div>

        <aside className="side">
          <section className={`panel panel-focus ${sel || picked ? "panel-sticky" : ""}`} aria-live="polite">
            {sel ? (
              <SelectionPanel
                label={`${dayLabel(days[sel.d])} ${slotLabel(sel.start)}–${slotLabel(sel.end)}`}
                status={rangeStatus(sel)}
                total={total}
                moving={Boolean(moving)}
                memo={memo}
                onMemo={setMemo}
                busy={busy}
                error={error}
                onConfirm={confirm}
                onClear={() => {
                  setSel(null);
                  setTapAnchor(null);
                  setError("");
                }}
              />
            ) : picked ? (
              <RehearsalPanel
                r={picked}
                busy={busy}
                error={error}
                onMove={() => {
                  setMovingId(picked.id);
                  setPickedId(null);
                  setError("");
                }}
                onCancel={() => cancelRehearsal(picked)}
                onClose={() => setPickedId(null)}
              />
            ) : hover && hoverCell ? (
              <HoverPanel
                label={`${dayLabel(days[hover.d])} ${slotLabel(hover.i)}`}
                members={members}
                statusOf={(m) => statusOf(m, hover.d, hover.i)}
              />
            ) : (
              <IdlePanel
                suggestions={suggestions}
                days={days}
                total={total}
                onPick={(s) => {
                  setPickedId(null);
                  setSel(s);
                }}
              />
            )}
          </section>

          <MembersPanel
            team={grid.team}
            days={days}
            availability={grid.availability}
            onSaved={load}
            onDeleted={() => router.push("/teams")}
          />
        </aside>
      </div>
    </div>
  );
}

function HeatLegend({ total }: { total: number }) {
  return (
    <div className="heat-legend" aria-label="색 범례">
      <span className="muted">0명</span>
      {[0, 1, 2, 3, 4, 5, 6].map((l) => (
        <i key={l} className={`swatch heat-${l}`} />
      ))}
      <span className="muted">{total}명 모두</span>
      <i className="swatch heat-0 cell-busy" />
      <span className="muted">다른 합주</span>
    </div>
  );
}

function NameList({ title, items, tone }: { title: string; items: string[]; tone: "ok" | "no" | "busy" | "class" }) {
  if (items.length === 0) return null;
  return (
    <div className={`namelist namelist-${tone}`}>
      <span className="namelist-title">
        {title} {items.length}
      </span>
      <span className="namelist-names">{items.join(", ")}</span>
    </div>
  );
}

function SelectionPanel(p: {
  label: string;
  status: { ok: Member[]; no: Member[]; blocked: { m: Member; teams: string[] }[]; inClass: { m: Member; titles: string[] }[] };
  total: number;
  moving: boolean;
  memo: string;
  onMemo: (v: string) => void;
  busy: boolean;
  error: string;
  onConfirm: () => void;
  onClear: () => void;
}) {
  const { ok, no, blocked, inClass } = p.status;
  return (
    <>
      <h2 className="panel-title">{p.label}</h2>
      <p className="big-count">
        <strong>{ok.length}</strong>
        <span>/{p.total}명 가능</span>
      </p>
      <NameList title="가능" items={ok.map((m) => m.name)} tone="ok" />
      <NameList title="수업" items={inClass.map((c) => `${c.m.name}(${c.titles.join(", ")})`)} tone="class" />
      <NameList title="일부 또는 불가" items={no.map((m) => m.name)} tone="no" />
      <NameList title="다른 합주" items={blocked.map((b) => `${b.m.name}(${b.teams.join(", ")})`)} tone="busy" />
      {blocked.length > 0 && <p className="warn">다른 합주가 있는 팀원이 있어서 이 시간은 잡을 수 없어요.</p>}
      {!p.moving && (
        <label className="field">
          <span className="field-label">메모 (선택)</span>
          <input className="input" value={p.memo} onChange={(e) => p.onMemo(e.target.value)} maxLength={200} placeholder="예: 셋리스트 1~3번" />
        </label>
      )}
      {p.error && <p className="error">{p.error}</p>}
      <div className="row">
        <button className="btn btn-primary" onClick={p.onConfirm} disabled={p.busy || blocked.length > 0}>
          {p.moving ? "이 시간으로 옮기기" : "합주 확정"}
        </button>
        <button className="btn btn-quiet" onClick={p.onClear}>
          선택 해제
        </button>
      </div>
    </>
  );
}

function RehearsalPanel(p: { r: Rehearsal; busy: boolean; error: string; onMove: () => void; onCancel: () => void; onClose: () => void }) {
  return (
    <>
      <h2 className="panel-title">{rangeLabel(p.r.startAt, p.r.endAt)}</h2>
      <p className="muted">확정된 합주</p>
      {p.r.memo && <p className="memo">{p.r.memo}</p>}
      <NameList title="참여" items={p.r.participants.map((m) => m.name)} tone="ok" />
      {p.error && <p className="error">{p.error}</p>}
      <div className="row">
        <button className="btn" onClick={p.onMove} disabled={p.busy}>
          시간 옮기기
        </button>
        <button className="btn btn-danger" onClick={p.onCancel} disabled={p.busy}>
          합주 취소
        </button>
        <button className="btn btn-quiet" onClick={p.onClose}>
          닫기
        </button>
      </div>
      <p className="fine">옮기거나 취소하면 팀원 모두의 화면과 캘린더 구독에 바로 반영돼요.</p>
    </>
  );
}

function HoverPanel({ label, members, statusOf }: { label: string; members: Member[]; statusOf: (id: string) => Status }) {
  const ok: string[] = [];
  const no: string[] = [];
  const busy: string[] = [];
  const cls: string[] = [];
  for (const m of members) {
    const s = statusOf(m.id);
    if (s.kind === "ok") ok.push(m.name);
    else if (s.kind === "busy") busy.push(`${m.name}(${s.teams.join(", ")})`);
    else if (s.kind === "class") cls.push(`${m.name}(${s.titles.join(", ")})`);
    else no.push(m.name);
  }
  return (
    <>
      <h2 className="panel-title">{label}</h2>
      <p className="big-count">
        <strong>{ok.length}</strong>
        <span>/{members.length}명 가능</span>
      </p>
      <NameList title="가능" items={ok} tone="ok" />
      <NameList title="수업" items={cls} tone="class" />
      <NameList title="불가" items={no} tone="no" />
      <NameList title="다른 합주" items={busy} tone="busy" />
    </>
  );
}

function IdlePanel({ suggestions, days, total, onPick }: { suggestions: Sel[]; days: Day[]; total: number; onPick: (s: Sel) => void }) {
  return (
    <>
      <h2 className="panel-title">모두 되는 시간</h2>
      {total === 0 ? (
        <p className="muted">팀원을 먼저 추가하세요.</p>
      ) : suggestions.length === 0 ? (
        <p className="muted">이번 주에는 {total}명 전원이 1시간 이상 겹치는 시간이 없어요. 가장 진한 칸을 골라 보거나 다음 주를 확인하세요.</p>
      ) : (
        <ul className="suggest-list">
          {suggestions.map((s) => (
            <li key={`${s.d}-${s.start}`}>
              <button className="suggest" onClick={() => onPick(s)}>
                <span>{dayLabel(days[s.d])}</span>
                <span className="suggest-time">
                  {slotLabel(s.start)}–{slotLabel(s.end)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="fine">칸에 마우스를 올리면 누가 되는지 보여요. 휴대폰에서는 시작 칸과 끝 칸을 차례로 누르면 구간이 선택돼요.</p>
    </>
  );
}

function MembersPanel(p: {
  team: Team;
  days: Day[];
  availability: TeamGrid["availability"];
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const filled = (memberId: string) => p.days.some((d) => (p.availability[memberId]?.[d] ?? []).length > 0);
  const missing = p.team.members.filter((m) => !filled(m.id));

  async function save() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/teams/${p.team.id}/members`, { method: "PUT", json: { memberIds: picked } });
      setEditing(false);
      p.onSaved();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`'${p.team.name}' 팀을 삭제할까요? 이 팀의 합주도 모두 지워져요.`)) return;
    try {
      await api(`/api/teams/${p.team.id}`, { method: "DELETE" });
      p.onDeleted();
    } catch (e) {
      setError(describeError(e));
    }
  }

  return (
    <section className="panel">
      <h2 className="panel-title">팀원 {p.team.members.length}명</h2>
      {editing ? (
        <>
          <MemberPicker selected={picked} onChange={setPicked} />
          <p className="fine">바꾼 팀원은 아직 시작하지 않은 이 팀 합주에도 같이 반영돼요.</p>
          {error && <p className="error">{error}</p>}
          <div className="row">
            <button className="btn btn-primary" onClick={save} disabled={busy}>
              팀원 저장
            </button>
            <button className="btn btn-quiet" onClick={() => setEditing(false)}>
              닫기
            </button>
          </div>
        </>
      ) : (
        <>
          <ul className="member-list">
            {p.team.members.map((m) => (
              <li key={m.id}>
                {m.name}
                {!filled(m.id) && <span className="tag">이번 주 미입력</span>}
              </li>
            ))}
          </ul>
          {missing.length > 0 && (
            <p className="fine">미입력인 사람은 이번 주 내내 불가로 계산돼요. 각자 내 시간 화면에서 칠해 달라고 알려주세요.</p>
          )}
          {error && <p className="error">{error}</p>}
          <div className="row">
            <button
              className="btn"
              onClick={() => {
                setPicked(p.team.members.map((m) => m.id));
                setEditing(true);
              }}
            >
              팀원 편집
            </button>
            <button className="btn btn-quiet btn-danger-text" onClick={remove}>
              팀 삭제
            </button>
          </div>
        </>
      )}
    </section>
  );
}
