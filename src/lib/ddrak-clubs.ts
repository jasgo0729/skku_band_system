// 뜨락을 같이 쓰는 동아리. 화면(브라우저)과 서버 양쪽에서 써요.
export const CLUBS = [
  { slug: "akui", name: "악의꽃", color: "orange" },
  { slug: "makmu", name: "막무간애", color: "blue" },
  { slug: "moyeo", name: "모여락", color: "yellow" },
] as const;

export type ClubSlug = (typeof CLUBS)[number]["slug"];

export function isClub(v: unknown): v is ClubSlug {
  return CLUBS.some((c) => c.slug === v);
}

export function clubName(slug: string): string {
  return CLUBS.find((c) => c.slug === slug)?.name ?? slug;
}

export type ddrakBooking = {
  id: string;
  club: ClubSlug;
  startAt: string;
  endAt: string;
  title: string | null;
  bookedBy: string | null;
};

export type ddrakSession = {
  club: ClubSlug | null;
  /** 비밀번호가 설정돼서 로그인할 수 있는 동아리 */
  enabled: ClubSlug[];
};
