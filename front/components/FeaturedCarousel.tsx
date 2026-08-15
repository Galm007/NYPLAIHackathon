"use client";

import { useEffect, useRef } from "react";
import { FeaturedCard } from "./FeaturedCard";
import type { ReportResponse } from "@/lib/types";

const SCROLL_SPEED = 0.18; // px per animation frame (~11px/s at 60fps)
const RESUME_DELAY = 2000; // ms after interaction stops before auto-scroll resumes

export function FeaturedCarousel({ reports }: { reports: ReportResponse[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const paused = useRef(false);
  const rafRef = useRef<number>(0);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Duplicate cards so we can loop seamlessly: when we reach the midpoint,
  // silently snap back to position 0 (which looks identical).
  const looped = [...reports, ...reports];

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function tick() {
      if (!paused.current && el) {
        el.scrollLeft += SCROLL_SPEED;
        // Seamless loop: halfway through the duplicated list = back to start
        if (el.scrollLeft >= el.scrollWidth / 2) {
          el.scrollLeft = 0;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);

    function pause() {
      paused.current = true;
      clearTimeout(resumeTimer.current);
    }

    function scheduleResume() {
      clearTimeout(resumeTimer.current);
      resumeTimer.current = setTimeout(() => {
        paused.current = false;
      }, RESUME_DELAY);
    }

    el.addEventListener("mouseenter", pause);
    el.addEventListener("mouseleave", scheduleResume);
    el.addEventListener("touchstart", pause, { passive: true });
    el.addEventListener("touchend", scheduleResume, { passive: true });
    el.addEventListener("wheel", pause, { passive: true });

    // Resume after wheel stops (wheel has no "end" event — schedule on each tick)
    function onWheel() {
      pause();
      scheduleResume();
    }
    el.removeEventListener("wheel", pause);
    el.addEventListener("wheel", onWheel, { passive: true });

    return () => {
      cancelAnimationFrame(rafRef.current);
      clearTimeout(resumeTimer.current);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="hide-scrollbar flex gap-4 overflow-x-auto pb-1"
      style={{
        scrollbarWidth: "none",
        msOverflowStyle: "none",
        WebkitOverflowScrolling: "touch",
        cursor: "grab",
      }}
    >
      {looped.map((report, i) => (
        <div
          key={`${report.address}-${i}`}
          className="w-[340px] flex-shrink-0"
        >
          <FeaturedCard report={report} />
        </div>
      ))}
    </div>
  );
}
