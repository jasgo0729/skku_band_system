"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { WeekGrid, WeekNav, type CellPos, type GridBlock } from "@/components/WeekGrid";
import { useRefresh, useWeek } from "@/components/useWeek";
import { api, describeError, RequestError } from "@/lib/client";
import { dayLabel, rangeLabel, slotLabel, slotToIso, spanOnGrid, SLOT_MINUTES } from "@/lib/time";
import { CLUBS, clubName, type ClubSlug, type ddrakBooking, type ddrakSession } from "@/lib/ddrak-clubs";

type Sel = { d: number; start: number; end: number };

export default function ddrakPage() {
  const week = useWeek();
  const { days, from, to } = week;
  const [bookings, setBookings] = useState<ddrakBooking[]>([]);
  const [session, setSession] = useState<ddrakSession | null>(null);
  const [loadError, setLoadError] = useState("");
  const [sel, setSel] = useState<Sel | null>(null);
  const [anchor, setAnchor] = useState<CellPos | null>(null);
  const [tapAnchor, setTapAnchor] = useState<CellPos | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [bookedBy, setBookedBy] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(() => {
    api<ddrakBooking[]>(`/api/ddrak/bookings?from=${from}&to=${to}`)
      .then((b) => {
        setBookings(b);
        setLoadError("");
      })
      .catch((e) => setLoadError(describeError(e)));
  }, [from, to]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSel(null);
    setTapAnchor(null);
    setPickedId(null);
  }, [load]);
  useRefresh(load);
  useRefresh(
    useCallback(() => setNow(Date.now()), []),
    60000,
  );

  useEffect(() => {
    api<ddrakSession>("/api/ddrak/session")
      .then(setSession)
      .catch(() => setSession({ club: null, enabled: [] }));
  }, []);

  const myClub = session?.club ?? null;
  const isPast = useCallback((d: number, i: number) => new Date(slotToIso(days[d], i + 1)).getTime() <= now, [days, now]);

  // 칸 → 그 칸을 차지한 예약
  const taken = useMemo(() => {
    const m = new Map<string, ddrakBooking>();
    for (const b of bookings) {
      if (b.id === movingId) continue;
      const s = spanOnGrid(b.startAt, b.endAt, days);
      if (s) for (let i = s.start; i < s.end; i++) m.set(`${s.d}|${i}`, b);
    }
    return m;
  }, [bookings, days, movingId]);

  const picked = bookings.find((b) => b.id === pickedId) ?? null;
  const moving = bookings.find((b) => b.id === movingId) ?? null;

  const blocks: GridBlock[] = bookings
    .map((b) => {
      const s = spanOnGrid(b.startAt, b.endAt, days);
      if (!s) return null;
      return {
        key: b.id,
        ...s,
        title: clubName(b.club),
        sub: b.title ?? undefined,
        extra: b.bookedBy ?? undefined, // 예약한 사람
        className: `club-${b.club} block-round`,
        active: b.id === pickedId,
        dim: b.id === movingId,
        onClick: () => {
          setSel(null);
          setTapAnchor(null);
          setError("");
          setPickedId(b.id);
        },
      } satisfies GridBlock;
    })
    .filter((b): b is NonNullable<typeof b> => b !== null);

  // 이번 주 동아리별 사용 시간
  const hoursByClub = useMemo(() => {
    const h: Record<string, number> = {};
    for (const b of bookings) {
      const s = spanOnGrid(b.startAt, b.endAt, days);
      if (s) h[b.club] = (h[b.club] ?? 0) + ((s.end - s.start) * SLOT_MINUTES) / 60;
    }
    return h;
  }, [bookings, days]);

  const selClash = sel
    ? [...new Set(Array.from({ length: sel.end - sel.start }, (_, k) => taken.get(`${sel.d}|${sel.start + k}`)).filter(Boolean))]
    : [];

  function startSelect(p: CellPos) {
    if (isPast(p.d, p.i)) return;
    setPickedId(null);
    setError("");
    setAnchor(p);
    setSel({ d: p.d, start: p.i, end: p.i + 1 });
  }

  async function submit() {
    if (!sel) return;
    setBusy(true);
    setError("");
    const startAt = slotToIso(days[sel.d], sel.start);
    const endAt = slotToIso(days[sel.d], sel.end);
    try {
      if (moving) {
        await api(`/api/ddrak/bookings/${moving.id}`, { method: "PATCH", json: { startAt, endAt } });
        setPickedId(moving.id);
        setMovingId(null);
      } else {
        const b = await api<ddrakBooking>("/api/ddrak/bookings", { method: "POST", json: { startAt, endAt, title, bookedBy } });
        setPickedId(b.id);
        setTitle("");
      }
      setSel(null);
      setTapAnchor(null);
      load();
    } catch (e) {
      setError(describeError(e));
      if (e instanceof RequestError && e.status === 401) refreshSession(); // 로그인이 풀린 경우
    } finally {
      setBusy(false);
    }
  }

  async function cancel(b: ddrakBooking) {
    if (!window.confirm(`${rangeLabel(b.startAt, b.endAt)} 뜨락 예약을 취소할까요?`)) return;
    setBusy(true);
    try {
      await api(`/api/ddrak/bookings/${b.id}`, { method: "DELETE" });
      setPickedId(null);
      load();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  function refreshSession() {
    api<ddrakSession>("/api/ddrak/session")
      .then(setSession)
      .catch(() => {});
  }

  const canEdit = Boolean(myClub);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">뜨락 대여</h1>
          <p className="muted">
            악의꽃 · 막무간애 · 모여락이 같이 쓰는 연습실이에요. 누구나 볼 수 있고, 예약은 동아리 관리자만 할 수 있어요.
          </p>
        </div>
      </div>

      <div className="toolbar">
        <WeekNav label={week.label} onPrev={week.prev} onNext={week.next} onToday={week.thisWeek} />
        <div className="club-legend" aria-label="동아리 색">
          {CLUBS.map((c) => (
            <span key={c.slug} className="club-legend-item">
              <i className={`club-dot club-${c.slug}`} />
              {c.name}
              <span className="muted">{hoursByClub[c.slug] ? ` ${hoursByClub[c.slug]}시간` : ""}</span>
            </span>
          ))}
        </div>
      </div>

      {loadError && <p className="error">{loadError}</p>}

      {moving && (
        <div className={`banner banner-club club-${moving.club}`} role="status">
          <span>
            <strong>{rangeLabel(moving.startAt, moving.endAt)}</strong> 예약을 옮길 새 시간을 고르세요.
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
              const selected = sel && sel.d === d && i >= sel.start && i < sel.end;
              const selCls = selected ? `cell-selected ${i === sel.start ? "sel-top" : ""} ${i === sel.end - 1 ? "sel-bottom" : ""}` : "";
              return `cell-room ${isPast(d, i) ? "cell-past" : ""} ${selCls}`;
            }}
            cellLabel={(d, i) => {
              const b = taken.get(`${d}|${i}`);
              return `${dayLabel(days[d])} ${slotLabel(i)}${b ? ` · ${clubName(b.club)} 예약` : ""}`;
            }}
            blocks={blocks}
            onDragStart={canEdit ? startSelect : undefined}
            onDragMove={(p) => {
              if (!anchor) return;
              let i = p.i;
              while (i < anchor.i && isPast(anchor.d, i)) i++;
              setSel({ d: anchor.d, start: Math.min(anchor.i, i), end: Math.max(anchor.i, i) + 1 });
            }}
            onDragEnd={() => setAnchor(null)}
            pending={tapAnchor}
            onTap={
              canEdit
                ? (p) => {
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
                  }
                : undefined
            }
          />
        </div>

        <aside className="side">
          {(sel || picked) && (
            <section className="panel panel-focus panel-sticky" aria-live="polite">
              {sel && myClub ? (
                <>
                  <h2 className="panel-title">{`${dayLabel(days[sel.d])} ${slotLabel(sel.start)}–${slotLabel(sel.end)}`}</h2>
                  <p>
                    <span className={`club-chip club-${myClub}`}>{clubName(myClub)}</span>
                    <span className="muted"> 이름으로 {moving ? "옮겨요" : "예약해요"}</span>
                  </p>
                  {selClash.length > 0 && (
                    <p className="warn">
                      이미 예약된 시간이 섞여 있어요:{" "}
                      {selClash.map((b) => `${clubName(b!.club)} ${rangeLabel(b!.startAt, b!.endAt)}`).join(", ")}
                    </p>
                  )}
                  {!moving && (
                    <>
                      <label className="field">
                        <span className="field-label">용도 (선택)</span>
                        <input
                          className="input"
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                          maxLength={60}
                          placeholder="예: 정기공연 A팀 합주"
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">예약한 사람 (선택)</span>
                        <input
                          className="input"
                          value={bookedBy}
                          onChange={(e) => setBookedBy(e.target.value)}
                          maxLength={30}
                          placeholder="예: 김드럼"
                        />
                      </label>
                    </>
                  )}
                  {error && <p className="error">{error}</p>}
                  <div className="row">
                    <button className="btn btn-primary" onClick={submit} disabled={busy || selClash.length > 0}>
                      {moving ? "이 시간으로 옮기기" : "뜨락 예약하기"}
                    </button>
                    <button
                      className="btn btn-quiet"
                      onClick={() => {
                        setSel(null);
                        setTapAnchor(null);
                        setError("");
                      }}
                    >
                      선택 해제
                    </button>
                  </div>
                </>
              ) : picked ? (
                <>
                  <h2 className="panel-title">{rangeLabel(picked.startAt, picked.endAt)}</h2>
                  <p>
                    <span className={`club-chip club-${picked.club}`}>{clubName(picked.club)}</span>
                  </p>
                  {picked.title && <p className="memo">{picked.title}</p>}
                  {picked.bookedBy && <p className="muted">예약한 사람: {picked.bookedBy}</p>}
                  {error && <p className="error">{error}</p>}
                  {picked.club === myClub ? (
                    <div className="row">
                      <button
                        className="btn"
                        disabled={busy}
                        onClick={() => {
                          setMovingId(picked.id);
                          setPickedId(null);
                          setError("");
                        }}
                      >
                        시간 옮기기
                      </button>
                      <button className="btn btn-danger" onClick={() => cancel(picked)} disabled={busy}>
                        예약 취소
                      </button>
                      <button className="btn btn-quiet" onClick={() => setPickedId(null)}>
                        닫기
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className="fine">{clubName(picked.club)} 관리자만 옮기거나 취소할 수 있어요.</p>
                      <div className="row">
                        <button className="btn btn-quiet" onClick={() => setPickedId(null)}>
                          닫기
                        </button>
                      </div>
                    </>
                  )}
                </>
              ) : null}
            </section>
          )}

          <AdminPanel session={session} onChange={setSession} />

          {!sel && !picked && (
            <section className="panel">
              <h2 className="panel-title">이번 주 예약 {bookings.length}건</h2>
              {bookings.length === 0 ? (
                <p className="muted">이번 주는 아직 비어 있어요.</p>
              ) : (
                <ul className="booking-list">
                  {bookings.map((b) => (
                    <li key={b.id}>
                      <button className="booking-item" onClick={() => setPickedId(b.id)}>
                        <i className={`club-dot club-${b.club}`} />
                        <span className="booking-when">{rangeLabel(b.startAt, b.endAt)}</span>
                        <span className="booking-what">
                          {clubName(b.club)}
                          {b.title ? ` · ${b.title}` : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function AdminPanel({ session, onChange }: { session: ddrakSession | null; onChange: (s: ddrakSession) => void }) {
  const [club, setClub] = useState<ClubSlug>("akui");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!session) return null;

  if (session.club) {
    return (
      <section className="panel">
        <h2 className="panel-title">관리자</h2>
        <p>
          <span className={`club-chip club-${session.club}`}>{clubName(session.club)}</span>
          <span className="muted"> 관리자로 로그인했어요</span>
        </p>
        <p className="fine">
          빈 시간을 드래그하면 예약돼요. 휴대폰은 시작 칸과 끝 칸을 차례로 누르세요. 우리 동아리 예약은 눌러서 옮기거나 취소할 수 있어요.
        </p>
        <div className="row">
          <button
            className="btn btn-quiet"
            onClick={async () => {
              try {
                onChange(await api<ddrakSession>("/api/ddrak/session", { method: "DELETE" }));
              } catch {}
            }}
          >
            로그아웃
          </button>
        </div>
      </section>
    );
  }

  async function login() {
    setBusy(true);
    setError("");
    try {
      onChange(await api<ddrakSession>("/api/ddrak/session", { method: "POST", json: { club, password } }));
      setPassword("");
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2 className="panel-title">관리자 로그인</h2>
      <p className="muted">예약하려면 동아리 관리자 계정으로 로그인하세요.</p>
      <div className="club-pick" role="radiogroup" aria-label="동아리">
        {CLUBS.map((c) => (
          <button
            key={c.slug}
            type="button"
            role="radio"
            aria-checked={club === c.slug}
            className={`club-pick-item ${club === c.slug ? `club-pick-on club-${c.slug}` : ""}`}
            onClick={() => setClub(c.slug)}
          >
            {c.name}
          </button>
        ))}
      </div>
      <form
        className="field"
        onSubmit={(e) => {
          e.preventDefault();
          if (password) login();
        }}
      >
        <input
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={`${clubName(club)} 관리자 비밀번호`}
          aria-label="비밀번호"
          autoComplete="current-password"
        />
        {!session.enabled.includes(club) && <p className="fine">이 동아리 비밀번호가 아직 설정되지 않았어요.</p>}
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary" disabled={busy || !password}>
          로그인
        </button>
      </form>
    </section>
  );
}
