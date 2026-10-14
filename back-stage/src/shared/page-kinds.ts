/**
 * Watch-face page kinds the control plane knows about. Safe to import from client and server.
 *
 * To add a page: append it here (config validation and the admin editor pick it up),
 * then register a component for the same kind in watch-face/src/registry/pages.tsx.
 */
export const PAGE_KINDS = [
  { kind: "home", label: "主表盘" },
  { kind: "weather", label: "天气详情" },
  { kind: "devices", label: "设备中心" },
  { kind: "schedule", label: "课程表" },
  { kind: "calendar", label: "完整日历" },
  { kind: "system", label: "Q775 状态" },
  { kind: "stocks", label: "股票趋势" },
  { kind: "sensors", label: "传感器" },
] as const;

export type PageKind = (typeof PAGE_KINDS)[number]["kind"];
export const pageKindIds = PAGE_KINDS.map((item) => item.kind) as [PageKind, ...PageKind[]];
