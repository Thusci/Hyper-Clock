/**
 * Moon phase from the date alone (mean synodic month from the 2000-01-06 18:14 UTC new moon).
 * Accurate to well under a day — far finer than HA's eight named states, which is what the
 * terminator needs to look right from one evening to the next.
 */
const SYNODIC_DAYS = 29.530588853;
const REFERENCE_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
const DAY = 86_400_000;

export type MoonPhase = {
  /** 0 = new, .25 = first quarter, .5 = full, .75 = last quarter. */
  fraction: number;
  /** Lit share of the disc, 0–1. */
  illumination: number;
  ageDays: number;
  waxing: boolean;
  name: string;
  daysToFull: number;
  daysToNew: number;
};

const names = ["新月", "蛾眉月", "上弦月", "盈凸月", "满月", "亏凸月", "下弦月", "残月"];

export function moonPhase(date = new Date()): MoonPhase {
  const cycles = (date.getTime() - REFERENCE_NEW_MOON) / DAY / SYNODIC_DAYS;
  const fraction = ((cycles % 1) + 1) % 1;
  const illumination = (1 - Math.cos(2 * Math.PI * fraction)) / 2;
  // Eight names centred on their phase (new moon spans ±1/16 of the cycle, and so on).
  const name = names[Math.floor(((fraction + 1 / 16) % 1) * 8)];
  return {
    fraction,
    illumination,
    ageDays: fraction * SYNODIC_DAYS,
    waxing: fraction < .5,
    name,
    daysToFull: (((.5 - fraction) % 1 + 1) % 1) * SYNODIC_DAYS,
    daysToNew: (1 - fraction) * SYNODIC_DAYS,
  };
}

/**
 * SVG path of the lit part of a disc of radius r at (cx, cy), seen from the northern
 * hemisphere (waxing light on the right). The terminator is a half-ellipse whose
 * horizontal radius is r·|cos 2πf|; it bulges into the lit half for crescents and
 * out of it for gibbous phases.
 */
export function litPath(fraction: number, cx: number, cy: number, r: number) {
  const k = Math.cos(2 * Math.PI * fraction);
  const rx = Math.max(.01, Math.abs(k) * r);
  const top = `${cx} ${cy - r}`;
  const bottom = `${cx} ${cy + r}`;
  if (fraction < .5) {
    // Right limb top → bottom, then the terminator back up.
    return `M ${top} A ${r} ${r} 0 0 1 ${bottom} A ${rx} ${r} 0 0 ${k > 0 ? 0 : 1} ${top} Z`;
  }
  // Left limb top → bottom, then the terminator back up.
  return `M ${top} A ${r} ${r} 0 0 0 ${bottom} A ${rx} ${r} 0 0 ${k > 0 ? 1 : 0} ${top} Z`;
}
