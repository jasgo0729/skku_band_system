"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, describeError, loadMe, saveMe } from "@/lib/client";
import { CLUBS, clubName, type ClubSlug } from "@/lib/ddrak-clubs";
import { composeName, SESSIONS } from "@/lib/member-name";
import type { Member } from "@/lib/types";

type MeCtx = { me: Member; setMe: (m: Member | null) => void };
const Ctx = createContext<MeCtx | null>(null);

type ShellCtx = { me: Member | null; ready: boolean; setMe: (m: Member | null) => void };
const Shell = createContext<ShellCtx>({ me: null, ready: false, setMe: () => {} });

/** 이름을 고른 뒤에만 렌더되는 화면(RequireMe 안)에서 쓰세요 */
export function useMe(): MeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMe는 RequireMe 안에서만 쓸 수 있어요");
  return v;
}

/**
 * 이름이 있어야 하는 화면을 감싸요. 이름이 없으면 이름 입력 화면을 보여줘요.
 * (AppShell이 화면 자체는 항상 그리고, 이름 확인은 여기서 해요.
 *  그래야 Next.js가 페이지를 미리 그려 보는 검사에서 페이지가 빠지지 않아요.)
 */
export function RequireMe({ children }: { children: ReactNode }) {
  const { me, ready, setMe } = useContext(Shell);
  if (!ready) return null; // 브라우저에 저장된 이름을 읽기 전
  if (!me) return <NameGate onPick={setMe} />;
  return <Ctx.Provider value={{ me, setMe }}>{children}</Ctx.Provider>;
}

const NAV = [
  { href: "/", label: "내 시간" },
  { href: "/teams", label: "팀" },
  { href: "/ddrak", label: "뜨락 대여" },
];

/** 이름 없이도 볼 수 있는 화면 (뜨락 대여는 합주 일정과 별개라 관리자 로그인만 써요) */
const OPEN_PATHS = ["/ddrak"];

export function AppShell({ children }: { children: ReactNode }) {
  const [me, setMeState] = useState<Member | null>(null);
  const [ready, setReady] = useState(false);
  const pathname = usePathname();
  const open = OPEN_PATHS.some((p) => pathname.startsWith(p));

  useEffect(() => {
    // localStorage는 브라우저에서만 읽을 수 있어서 마운트 후에 불러와요
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMeState(loadMe());
    setReady(true);
  }, []);

  const setMe = (m: Member | null) => {
    saveMe(m);
    setMeState(m);
  };

  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand" aria-label="합주표 홈">
          <span className="tape tape-brand">합주표</span>
        </Link>
        {(me || open) && (
          <nav className="nav" aria-label="주요 메뉴">
            {NAV.map((n) => {
              const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
              return (
                <Link key={n.href} href={n.href} className={active ? "nav-link active" : "nav-link"} aria-current={active ? "page" : undefined}>
                  {n.label}
                </Link>
              );
            })}
          </nav>
        )}
        {me && (
          <button className="me-chip" onClick={() => setMe(null)} title="다른 이름으로 바꾸기">
            {me.name}
            <span className="me-chip-action">바꾸기</span>
          </button>
        )}
      </header>
      <main className="main">
        <Shell.Provider value={{ me, ready, setMe }}>{children}</Shell.Provider>
      </main>
    </>
  );
}

function NameGate({ onPick }: { onPick: (m: Member) => void }) {
  const [club, setClub] = useState<ClubSlug | null>(null);
  const [gen, setGen] = useState("");
  const [session, setSession] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const clubLabel = club ? clubName(club) : "";
  const ready = Boolean(club && gen && session && name.trim());
  const full = ready ? composeName(clubLabel, gen, session!, name) : "";

  async function submit() {
    if (!ready) return;
    setBusy(true);
    setError("");
    try {
      onPick(await api<Member>("/api/members", { method: "POST", json: { name: full } }));
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  }

  return (
    <section className="gate">
      <h1 className="gate-title">누구인지 알려주세요</h1>
      <p className="muted">로그인은 없어요. 매번 같은 정보로 들어오면 같은 사람으로 이어져요.</p>
      <form
        className="gate-fields"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="field">
          <span className="field-label" id="gate-club">동아리</span>
          <div className="club-pick" role="radiogroup" aria-labelledby="gate-club">
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
        </div>

        <label className="field">
          <span className="field-label">기수</span>
          <input
            className="input input-gen"
            value={gen}
            onChange={(e) => setGen(e.target.value.replace(/\D/g, "").slice(0, 3))}
            inputMode="numeric"
            placeholder="예: 40"
            aria-label="기수"
          />
        </label>

        <div className="field">
          <span className="field-label" id="gate-session">세션</span>
          <div className="session-pick" role="radiogroup" aria-labelledby="gate-session">
            {SESSIONS.map((s) => (
              <button
                key={s.code}
                type="button"
                role="radio"
                aria-checked={session === s.code}
                className={`session-pick-item ${session === s.code ? "session-pick-on" : ""}`}
                onClick={() => setSession(s.code)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span className="field-label">이름</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={12} placeholder="예: 김민재" aria-label="이름" />
        </label>

        <p className="gate-preview" aria-live="polite">
          {ready ? (
            <>
              <span className="muted">이 이름으로 들어가요</span>
              <strong>{full}</strong>
            </>
          ) : (
            <span className="muted">네 칸을 모두 채우면 이름이 만들어져요</span>
          )}
        </p>

        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary btn-block" disabled={busy || !ready}>
          시작하기
        </button>
      </form>
    </section>
  );
}
