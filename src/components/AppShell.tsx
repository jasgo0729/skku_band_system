"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, describeError, loadMe, saveMe } from "@/lib/client";
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
  const [members, setMembers] = useState<Member[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Member[]>("/api/members").then(setMembers).catch(() => {});
  }, []);

  async function submit(n: string) {
    if (!n.trim()) return;
    setBusy(true);
    setError("");
    try {
      onPick(await api<Member>("/api/members", { method: "POST", json: { name: n } }));
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  }

  return (
    <section className="gate">
      <h1 className="gate-title">이름을 알려주세요</h1>
      <p className="muted">
        로그인은 없어요. 이름으로 구분하니까 매번 같은 이름을 쓰세요. (ex. 악의꽃 40G 김민재)
      </p>
      <form
        className="gate-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit(name);
        }}
      >
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="예: 악의꽃 40G 김민재"
          maxLength={30}
          aria-label="이름"
          autoFocus
        />
        <button className="btn btn-primary" disabled={busy || !name.trim()}>
          시작하기
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
