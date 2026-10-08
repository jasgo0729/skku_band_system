import type { Day } from "./time";

export type Member = { id: string; name: string };

export type Team = { id: string; name: string; members: Member[] };

/** 날짜 → 가능한 칸 번호들 */
export type DaySlots = Record<Day, number[]>;

export type Rehearsal = {
  id: string;
  teamId: string;
  teamName: string;
  startAt: string;
  endAt: string;
  memo: string | null;
  participants: Member[];
};

/** 다른 합주 때문에 이미 잡혀 있는 시간 */
export type Busy = {
  memberId: string;
  rehearsalId: string;
  teamId: string;
  teamName: string;
  startAt: string;
  endAt: string;
};

export type Conflict = {
  memberName: string;
  teamName: string;
  startAt: string;
  endAt: string;
};

/** 매주 반복되는 수업. weekday 0 = 월, 분 단위 */
export type ClassBlock = {
  weekday: number;
  startMin: number;
  endMin: number;
  title: string;
};

export type TeamGrid = {
  team: Team;
  availability: Record<string, DaySlots>; // memberId → 날짜별 칸
  classes: Record<string, ClassBlock[]>; // memberId → 수업
  busy: Busy[];
  rehearsals: Rehearsal[]; // 이 팀 합주
};
