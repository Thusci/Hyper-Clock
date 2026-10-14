"use client";

import { useEffect, useRef } from "react";
import { useLocalClock } from "@/hooks/use-local-clock";

const secondTicks = Array.from({ length: 60 }, (_, index) => ({
  angle: index * 6,
  major: index % 5 === 0,
}));

export function ClockMark({ locale, timezone, clockScale = 100, minimal = false }: { locale: string; timezone: string; clockScale?: number; minimal?: boolean }) {
  const clock = useLocalClock(locale, timezone);
  const rotor = useRef<SVGGElement>(null);
  const scale = Math.min(1.25, Math.max(.72, clockScale / 100));
  const digitSize = minimal
    ? `clamp(${(7.6 * scale).toFixed(2)}rem, ${(24 * scale).toFixed(2)}vw, ${(20 * scale).toFixed(2)}rem)`
    : `clamp(${(5.4 * scale).toFixed(2)}rem, ${(17 * scale).toFixed(2)}cqw, ${(11 * scale).toFixed(2)}rem)`;

  useEffect(() => {
    const node = rotor.current;
    if (!node) return;
    const now = new Date();
    node.style.setProperty("--seconds-phase", String(now.getSeconds() + now.getMilliseconds() / 1000));
    node.classList.add("seconds-rotor-running");
  }, []);

  return (
    <div className={`clock-mark ${minimal ? "clock-mark-minimal text-center" : "clock-mark-full"}`} role="timer" aria-live="off" aria-label={`${clock.hours}:${clock.minutes}:${clock.seconds}`}>
      <div className={`clock-row flex items-center ${minimal ? "justify-center" : "justify-start"}`}>
        <div className="clock-digits font-display font-semibold tabular-nums tracking-[-.078em] leading-[.8]" style={{ fontSize: digitSize }}>
          {clock.hours}<span className="clock-colon mx-[.025em] text-[.48em]">:</span>{clock.minutes}
        </div>
        <div className="seconds-dial relative shrink-0">
          <svg className="absolute inset-0 size-full" viewBox="0 0 100 100" aria-hidden="true">
            <circle className="seconds-track" cx="50" cy="50" r="45" fill="none" strokeWidth="1.5" />
            <g className="seconds-ticks">
              {secondTicks.map((tick) => (
                <line
                  key={tick.angle}
                  className={tick.major ? "seconds-tick-major" : "seconds-tick-minor"}
                  x1="50"
                  y1={tick.major ? 5 : 7}
                  x2="50"
                  y2={tick.major ? 13 : 10}
                  transform={`rotate(${tick.angle} 50 50)`}
                />
              ))}
            </g>
            <g ref={rotor} className="seconds-rotor">
              <line className="seconds-hand" x1="50" y1="61" x2="50" y2="9" />
              <circle className="seconds-counterweight" cx="50" cy="64" r="3.2" />
              <circle className="seconds-hub" cx="50" cy="50" r="3.4" />
            </g>
          </svg>
          <span className="seconds-value absolute inset-0 grid place-items-center font-mono font-medium tabular-nums">{clock.seconds}</span>
        </div>
      </div>
      {!minimal && (
        <div className="clock-date-row flex items-baseline">
          <span className="clock-date font-medium tracking-[-.025em]">{clock.date}</span>
        </div>
      )}
    </div>
  );
}
