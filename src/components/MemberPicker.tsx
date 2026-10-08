"use client";

import { useEffect, useState } from "react";
import { api, describeError } from "@/lib/client";
import type { Member } from "@/lib/types";

/** 등록된 사람 중에서 고르고, 없으면 이름을 바로 추가 */
export function MemberPicker({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api<Member[]>("/api/members").then(setMembers).catch((e) => setError(describeError(e)));
  }, []);

  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  async function add() {
    setError("");
    try {
      const m = await api<Member>("/api/members", { method: "POST", json: { name: newName } });
      setMembers((ms) => (ms.some((x) => x.id === m.id) ? ms : [...ms, m].sort((a, b) => a.name.localeCompare(b.name, "ko"))));
      if (!selected.includes(m.id)) onChange([...selected, m.id]);
      setNewName("");
    } catch (e) {
      setError(describeError(e));
    }
  }

  return (
    <div className="picker">
      <div className="chips">
        {members.map((m) => {
          const on = selected.includes(m.id);
          return (
            <button key={m.id} type="button" className={on ? "chip chip-on" : "chip"} aria-pressed={on} onClick={() => toggle(m.id)}>
              {m.name}
            </button>
          );
        })}
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (newName.trim()) add();
        }}
      >
        <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={30} placeholder="목록에 없는 사람 이름" aria-label="새 멤버 이름" />
        <button className="btn" disabled={!newName.trim()}>
          추가
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
