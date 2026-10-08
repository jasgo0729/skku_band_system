"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { dateNumber, GRID_END_SLOT, GRID_FIRST_SLOT, slotLabel, todayKst, weekdayOf, type Day } from "@/lib/time";

export type CellPos = { d: number; i: number }; // 요일 인덱스, 칸 번호

export type GridBlock = {
  key: string;
  d: number;
  start: number; // 칸 번호
  end: number; // 끝 칸 번호(포함 안 함)
  title: string;
  sub?: string;
  /** 세 번째 줄 (예: 예약한 사람) */
  extra?: string;
  tone?: number; // 테이프 색 0~4
  lane?: number;
  lanes?: number;
  active?: boolean;
  dim?: boolean;
  /** tape = 확정된 합주, class = 수업 (회색, 클릭 안 됨) */
  variant?: "tape" | "class";
  /** 테이프 색을 tone 대신 직접 지정할 때 (예: 뜨락 동아리 색) */
  className?: string;
  onClick?: () => void;
};

type Props = {
  days: Day[];
  cellClass: (d: number, i: number) => string;
  cellStyle?: (d: number, i: number) => CSSProperties | undefined;
  cellLabel?: (d: number, i: number) => string;
  blocks?: GridBlock[];
  /** 드래그 시작 · 이동 · 끝. 없으면 그리드는 보기 전용 */
  onDragStart?: (p: CellPos) => void;
  onDragMove?: (p: CellPos) => void;
  onDragEnd?: () => void;
  onHover?: (p: CellPos | null) => void;
  /** 휴대폰: 드래그 대신 탭. 화면 스크롤을 막지 않으려고 터치는 탭 두 번으로 구간을 골라요 */
  onTap?: (p: CellPos) => void;
  /** 탭으로 시작점만 찍어 둔 칸 */
  pending?: CellPos | null;
  blocksInteractive?: boolean;
  footer?: ReactNode;
  /** 처음 열 때 이 칸이 맨 위에 오게 스크롤 (기본 09:00) */
  initialSlot?: number;
};

const ROWS = Array.from({ length: GRID_END_SLOT - GRID_FIRST_SLOT }, (_, k) => GRID_FIRST_SLOT + k);

function cellAt(x: number, y: number): CellPos | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-cell]");
  if (!el) return null;
  return { d: Number(el.dataset.d), i: Number(el.dataset.i) };
}

export function WeekGrid(props: Props) {
  const { days, cellClass, cellStyle, cellLabel, blocks = [], onDragStart, onDragMove, onDragEnd, onHover, onTap, pending } = props;
  const pointerType = useRef("mouse");
  const [dragging, setDragging] = useState(false);
  const last = useRef<string>("");
  const today = todayKst();
  const handlers = useRef({ onDragMove, onDragEnd });
  handlers.current = { onDragMove, onDragEnd };
  const scrollRef = useRef<HTMLDivElement>(null);
  const initialSlot = props.initialSlot ?? 18;

  // 00~24시를 다 그리되, 처음엔 자주 쓰는 시간대부터 보이게
  useEffect(() => {
    const box = scrollRef.current;
    const cell = box?.querySelector<HTMLElement>("[data-cell]");
    if (box && cell) box.scrollTop = cell.offsetHeight * (initialSlot - GRID_FIRST_SLOT);
  }, [initialSlot]);

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      // 드래그하다 위·아래 끝에 닿으면 자동으로 스크롤
      const box = scrollRef.current;
      if (box) {
        const r = box.getBoundingClientRect();
        if (e.clientY < r.top + 48) box.scrollTop -= 12;
        else if (e.clientY > r.bottom - 20) box.scrollTop += 12;
      }
      const p = cellAt(e.clientX, e.clientY);
      if (!p) return;
      const k = `${p.d}:${p.i}`;
      if (k === last.current) return;
      last.current = k;
      handlers.current.onDragMove?.(p);
    };
    const up = () => {
      setDragging(false);
      handlers.current.onDragEnd?.();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [dragging]);

  const interactive = Boolean(onDragStart);

  return (
    <div className="grid-scroll" ref={scrollRef}>
      <div
        className={`grid ${interactive ? "grid-interactive" : ""} ${onTap ? "grid-tappable" : ""} ${dragging ? "grid-dragging" : ""}`}
        style={{ "--rows": ROWS.length } as CSSProperties}
        onPointerDown={(e) => {
          pointerType.current = e.pointerType;
          if (e.pointerType === "touch" && onTap) return; // 터치는 스크롤 그대로, 탭은 onClick에서
          if (!onDragStart || e.button !== 0) return;
          const p = cellAt(e.clientX, e.clientY);
          if (!p) return;
          e.preventDefault();
          last.current = `${p.d}:${p.i}`;
          setDragging(true);
          onDragStart(p);
        }}
        onPointerMove={(e) => {
          if (dragging || !onHover || e.pointerType !== "mouse") return;
          onHover(cellAt(e.clientX, e.clientY));
        }}
        onPointerLeave={() => onHover?.(null)}
        onClick={(e) => {
          if (pointerType.current !== "touch" || !onTap) return;
          const el = (e.target as HTMLElement).closest<HTMLElement>("[data-cell]");
          if (el) onTap({ d: Number(el.dataset.d), i: Number(el.dataset.i) });
        }}
      >
        <div className="grid-corner" />
        {days.map((day) => (
          <div key={day} className={day === today ? "grid-head today" : "grid-head"}>
            <span className="grid-dow">{weekdayOf(day)}</span>
            <span className="grid-date">{dateNumber(day)}</span>
          </div>
        ))}

        <div className="grid-times" aria-hidden>
          {ROWS.map((i) => (
            <div key={i} className="grid-time">
              {i % 2 === 0 ? slotLabel(i) : ""}
            </div>
          ))}
        </div>

        {days.map((day, d) => (
          <div key={day} className="grid-col">
            {ROWS.map((i) => (
              <div
                key={i}
                data-cell=""
                data-d={d}
                data-i={i}
                className={`cell ${i % 2 === 0 ? "cell-hour" : ""} ${pending && pending.d === d && pending.i === i ? "cell-pending" : ""} ${cellClass(d, i)}`}
                style={cellStyle?.(d, i)}
                title={cellLabel?.(d, i)}
              />
            ))}
            {blocks
              .filter((b) => b.d === d)
              .map((b) => {
                const lanes = b.lanes ?? 1;
                const lane = b.lane ?? 0;
                const style = {
                  top: `calc(var(--row) * ${b.start - GRID_FIRST_SLOT})`,
                  height: `calc(var(--row) * ${Math.min(b.end, GRID_END_SLOT) - Math.max(b.start, GRID_FIRST_SLOT)})`,
                  left: `calc(${(lane / lanes) * 100}% + 2px)`,
                  width: `calc(${100 / lanes}% - 4px)`,
                } as CSSProperties;
                const cls =
                  b.variant === "class"
                    ? "block block-class"
                    : `block tape ${b.className ?? `tape-${b.tone ?? 0}`} ${b.active ? "block-active" : ""} ${b.dim ? "block-dim" : ""}`;
                return b.onClick && b.variant !== "class" && props.blocksInteractive !== false ? (
                  <button key={b.key} className={cls} style={style} onPointerDown={(e) => e.stopPropagation()} onClick={b.onClick}>
                    <span className="block-title">{b.title}</span>
                    {b.sub && <span className="block-sub">{b.sub}</span>}
                    {b.extra && <span className="block-sub block-extra">{b.extra}</span>}
                  </button>
                ) : (
                  <div key={b.key} className={`${cls} block-static`} style={style}>
                    <span className="block-title">{b.title}</span>
                    {b.sub && <span className="block-sub">{b.sub}</span>}
                    {b.extra && <span className="block-sub block-extra">{b.extra}</span>}
                  </div>
                );
              })}
          </div>
        ))}
        {props.footer}
      </div>
    </div>
  );
}

export function WeekNav({
  label,
  onPrev,
  onNext,
  onToday,
}: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  return (
    <div className="weeknav">
      <button className="btn btn-quiet" onClick={onPrev} aria-label="이전 주">
        ‹
      </button>
      <span className="weeknav-label">{label}</span>
      <button className="btn btn-quiet" onClick={onNext} aria-label="다음 주">
        ›
      </button>
      <button className="btn btn-quiet" onClick={onToday}>
        이번 주
      </button>
    </div>
  );
}

/** 겹치는 블록을 나란히 놓을 레인 계산 */
export function assignLanes<T extends { d: number; start: number; end: number }>(items: T[]): (T & { lane: number; lanes: number })[] {
  const out: (T & { lane: number; lanes: number })[] = [];
  const byDay = new Map<number, T[]>();
  for (const it of items) byDay.set(it.d, [...(byDay.get(it.d) ?? []), it]);
  for (const list of byDay.values()) {
    list.sort((a, b) => a.start - b.start || b.end - a.end);
    // 서로 이어진 묶음(cluster)마다 레인 수를 맞춰요
    let cluster: (T & { lane: number; lanes: number })[] = [];
    let clusterEnd = -1;
    const flush = () => {
      const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1));
      cluster.forEach((c) => (c.lanes = lanes));
      out.push(...cluster);
      cluster = [];
    };
    for (const it of list) {
      if (it.start >= clusterEnd && cluster.length) flush();
      const used = cluster.filter((c) => c.end > it.start).map((c) => c.lane);
      let lane = 0;
      while (used.includes(lane)) lane++;
      cluster.push({ ...it, lane, lanes: 1 });
      clusterEnd = Math.max(clusterEnd, it.end);
    }
    if (cluster.length) flush();
  }
  return out;
}
