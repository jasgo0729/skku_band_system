"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { RequireMe, useMe } from "@/components/AppShell";
import { MemberPicker } from "@/components/MemberPicker";
import { api, describeError } from "@/lib/client";
import type { Team } from "@/lib/types";

export default function Page() {
  return (
    <RequireMe>
      <TeamsPage />
    </RequireMe>
  );
}

function TeamsPage() {
  const { me } = useMe();
  const router = useRouter();
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([me.id]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Team[]>("/api/teams")
      .then(setTeams)
      .catch((e) => setError(describeError(e)));
  }, []);

  // 이 화면은 다른 화면에 갔다 와도 입력 상태가 그대로 남아요(Next.js가 화면을 숨겨 두기만 해서).
  // 그래서 새 팀 폼을 열거나 닫거나 팀을 만든 뒤에는 직접 처음 상태로 돌려요.
  function resetForm(open: boolean) {
    setCreating(open);
    setName("");
    setPicked([me.id]);
    setError("");
    setBusy(false);
  }

  async function create() {
    setBusy(true);
    setError("");
    try {
      const team = await api<Team>("/api/teams", { method: "POST", json: { name, memberIds: picked } });
      resetForm(false);
      setTeams((ts) => (ts ? [...ts, team] : ts));
      router.push(`/teams/${team.id}`);
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  }

  const mine = teams?.filter((t) => t.members.some((m) => m.id === me.id)) ?? [];
  const others = teams?.filter((t) => !t.members.some((m) => m.id === me.id)) ?? [];

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div>
          <h1 className="page-title">팀</h1>
          <p className="muted">팀을 열면 팀원 전원의 가능 시간이 겹쳐 보여요. 거기서 합주를 확정하면 모두의 화면에 바로 반영돼요.</p>
        </div>
        {!creating && (
          <button className="btn btn-primary" onClick={() => resetForm(true)}>
            팀 만들기
          </button>
        )}
      </div>

      {creating && (
        <section className="panel">
          <h2 className="panel-title">새 팀</h2>
          <label className="field">
            <span className="field-label">팀 이름</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="예: 3기 정기공연 A팀" autoFocus />
          </label>
          <div className="field">
            <span className="field-label">팀원</span>
            <MemberPicker selected={picked} onChange={setPicked} />
          </div>
          {error && <p className="error">{error}</p>}
          <div className="row">
            <button className="btn btn-primary" onClick={create} disabled={busy || !name.trim() || picked.length === 0}>
              팀 만들기
            </button>
            <button className="btn btn-quiet" onClick={() => resetForm(false)}>
              닫기
            </button>
          </div>
        </section>
      )}

      {!creating && error && <p className="error">{error}</p>}
      {teams === null ? (
        <p className="muted">불러오는 중</p>
      ) : teams.length === 0 ? (
        <p className="empty">아직 팀이 없어요. 첫 팀을 만들어 보세요.</p>
      ) : (
        <>
          <TeamList title="내 팀" teams={mine} empty="아직 속한 팀이 없어요." />
          {others.length > 0 && <TeamList title="다른 팀" teams={others} />}
        </>
      )}
    </div>
  );
}

function TeamList({ title, teams, empty }: { title: string; teams: Team[]; empty?: string }) {
  return (
    <section className="team-section">
      <h2 className="section-title">{title}</h2>
      {teams.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <ul className="team-list">
          {teams.map((t) => (
            <li key={t.id}>
              <Link href={`/teams/${t.id}`} className="team-row">
                <span className="team-name">{t.name}</span>
                <span className="team-members">{t.members.map((m) => m.name).join(", ") || "팀원 없음"}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
