"use client";

import { useEffect, useMemo, useState } from "react";
import { useMe } from "@/components/AppShell";
import { api, describeError } from "@/lib/client";
import { composeName, parseName, SESSIONS, type ParsedName, type SessionCode } from "@/lib/member-name";
import type { Member } from "@/lib/types";

type Row = Member & { p: ParsedName };

/**
 * 팀원 고르기. 내 동아리 사람만 세션별로 보여주고, 이름 · 기수 검색과 세션 · 기수 필터를 지원해요.
 * 목록에 없는 사람은 기수 · 세션 · 이름만 넣으면 내 동아리로 바로 추가돼요.
 */
export function MemberPicker({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const { me } = useMe();
  const myClub = parseName(me.name)?.club ?? null;

  const [members, setMembers] = useState<Member[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sessionFilter, setSessionFilter] = useState<SessionCode | null>(null);
  const [genFilter, setGenFilter] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    api<Member[]>("/api/members")
      .then((ms) => {
        setMembers(ms);
        setLoaded(true);
      })
      .catch((e) => setError(describeError(e)));
  }, []);

  // 내 동아리 사람만 (이름 형식이 맞는 사람)
  const clubRows: Row[] = useMemo(
    () =>
      members
        .map((m) => ({ ...m, p: parseName(m.name) }))
        .filter((m): m is Row => m.p !== null && m.p.club === myClub)
        .sort((a, b) => b.p.gen - a.p.gen || a.p.name.localeCompare(b.p.name, "ko")),
    [members, myClub],
  );

  const gens = useMemo(() => [...new Set(clubRows.map((r) => r.p.gen))].sort((a, b) => b - a), [clubRows]);

  const q = query.trim().replace(/\s+/g, "").toLowerCase();
  const visible = clubRows.filter((r) => {
    if (sessionFilter && r.p.session !== sessionFilter) return false;
    if (genFilter !== null && r.p.gen !== genFilter) return false;
    if (!q) return true;
    // "김민", "40", "40G", "40기", "기타" 모두 찾을 수 있게
    const hay = [r.p.name, `${r.p.gen}`, `${r.p.gen}${r.p.session}`, `${r.p.gen}기`, SESSIONS.find((s) => s.code === r.p.session)!.label]
      .join(" ")
      .replace(/\s+/g, "")
      .toLowerCase();
    return hay.includes(q) || r.p.name.replace(/\s+/g, "").toLowerCase().includes(q);
  });

  const groups = SESSIONS.map((s) => ({ ...s, rows: visible.filter((r) => r.p.session === s.code) })).filter((g) => g.rows.length > 0);

  const selectedMembers = selected
    .map((id) => members.find((m) => m.id === id))
    .filter((m): m is Member => Boolean(m))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));

  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const filtering = Boolean(q || sessionFilter || genFilter !== null);

  return (
    <div className="picker">
      <div className="picker-selected">
        <span className="picker-count">선택 {selected.length}명</span>
        {selectedMembers.length > 0 ? (
          <div className="chips">
            {selectedMembers.map((m) => (
              <button key={m.id} type="button" className="chip chip-on chip-remove" onClick={() => toggle(m.id)} aria-label={`${m.name} 빼기`}>
                {m.name}
                <span aria-hidden>×</span>
              </button>
            ))}
          </div>
        ) : (
          <span className="muted">아래에서 팀원을 눌러 고르세요.</span>
        )}
      </div>

      {!myClub ? (
        <p className="warn">
          내 이름이 &quot;동아리 기수세션 이름&quot; 형식이 아니라서 동아리를 알 수 없어요. 오른쪽 위 이름을 눌러 다시 들어오면 같은 동아리 사람을 볼 수 있어요.
        </p>
      ) : (
        <>
          <div className="picker-tools">
            <input
              className="input"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="이름이나 기수로 찾기 (예: 김민, 40)"
              aria-label={`${myClub} 멤버 검색`}
            />
            <select
              className="input picker-gen"
              value={genFilter ?? ""}
              onChange={(e) => setGenFilter(e.target.value === "" ? null : Number(e.target.value))}
              aria-label="기수 필터"
            >
              <option value="">전체 기수</option>
              {gens.map((g) => (
                <option key={g} value={g}>
                  {g}기
                </option>
              ))}
            </select>
          </div>

          <div className="filter-chips" role="group" aria-label="세션 필터">
            <button type="button" className={sessionFilter === null ? "fchip fchip-on" : "fchip"} aria-pressed={sessionFilter === null} onClick={() => setSessionFilter(null)}>
              전체
            </button>
            {SESSIONS.map((s) => (
              <button
                key={s.code}
                type="button"
                className={sessionFilter === s.code ? "fchip fchip-on" : "fchip"}
                aria-pressed={sessionFilter === s.code}
                onClick={() => setSessionFilter(sessionFilter === s.code ? null : s.code)}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="picker-groups">
            {!loaded ? (
              <p className="muted">불러오는 중</p>
            ) : clubRows.length === 0 ? (
              <p className="muted">아직 등록된 {myClub} 멤버가 없어요. 아래에서 추가하세요.</p>
            ) : groups.length === 0 ? (
              <p className="muted">
                조건에 맞는 사람이 없어요.{" "}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setQuery("");
                    setSessionFilter(null);
                    setGenFilter(null);
                  }}
                >
                  검색 · 필터 지우기
                </button>
              </p>
            ) : (
              groups.map((g) => (
                <section key={g.code} className="picker-group">
                  <h3 className="picker-group-title">
                    {g.label} <span className="muted">{g.rows.length}</span>
                  </h3>
                  <div className="chips">
                    {g.rows.map((r) => {
                      const on = selected.includes(r.id);
                      return (
                        <button key={r.id} type="button" className={on ? "chip chip-on" : "chip"} aria-pressed={on} onClick={() => toggle(r.id)} title={r.name}>
                          <span className="chip-gen">{r.p.gen}</span>
                          {r.p.name}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))
            )}
            {filtering && groups.length > 0 && <p className="fine">{visible.length}명 표시 중 · 전체 {clubRows.length}명</p>}
          </div>

          {adding ? (
            <AddMember
              club={myClub}
              onAdded={(m) => {
                setMembers((ms) => (ms.some((x) => x.id === m.id) ? ms : [...ms, m]));
                if (!selected.includes(m.id)) onChange([...selected, m.id]);
                setAdding(false);
              }}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <button type="button" className="btn btn-quiet picker-add" onClick={() => setAdding(true)}>
              목록에 없는 {myClub} 멤버 추가
            </button>
          )}
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function AddMember({ club, onAdded, onCancel }: { club: string; onAdded: (m: Member) => void; onCancel: () => void }) {
  const [gen, setGen] = useState("");
  const [session, setSession] = useState<SessionCode | "">("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = Boolean(gen && session && name.trim());

  async function add() {
    if (!ready) return;
    setBusy(true);
    setError("");
    try {
      onAdded(await api<Member>("/api/members", { method: "POST", json: { name: composeName(club, gen, session, name) } }));
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  }

  return (
    <div className="picker-addform">
      <div className="picker-addrow">
        <input
          className="input"
          value={gen}
          onChange={(e) => setGen(e.target.value.replace(/\D/g, "").slice(0, 3))}
          inputMode="numeric"
          placeholder="기수"
          aria-label="기수"
        />
        <select className="input" value={session} onChange={(e) => setSession(e.target.value as SessionCode)} aria-label="세션">
          <option value="">세션</option>
          {SESSIONS.map((s) => (
            <option key={s.code} value={s.code}>
              {s.label}
            </option>
          ))}
        </select>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={12}
          placeholder="이름"
          aria-label="이름"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
      </div>
      <p className="fine">{ready ? `"${composeName(club, gen, session, name)}"(으)로 추가돼요` : "기수 · 세션 · 이름을 모두 넣으세요"}</p>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="button" className="btn" onClick={add} disabled={busy || !ready}>
          추가하고 선택
        </button>
        <button type="button" className="btn btn-quiet" onClick={onCancel}>
          취소
        </button>
      </div>
    </div>
  );
}
