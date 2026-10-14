import { CircleCheck, CircleDashed, CircleX } from "lucide-react";

export function StatusPill({ status, usingCache = false }: { status: "connecting" | "connected" | "offline"; usingCache?: boolean }) {
  const styles = {
    connected: [CircleCheck, "已连接", "text-[var(--green)]"],
    connecting: [CircleDashed, "连接中", "text-[var(--amber)]"],
    offline: [CircleX, "离线", "text-[var(--red)]"],
  } as const;
  if (usingCache) {
    return <span className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[rgb(var(--surface-rgb)/.16)] px-3 py-1.5 text-xs font-medium text-[var(--amber)]"><CircleDashed size={14} /> Home Assistant · 缓存</span>;
  }
  const [Icon, label, color] = styles[status];
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[rgb(var(--surface-rgb)/.16)] px-3 py-1.5 text-xs font-medium ${color}`}>
      <Icon size={14} strokeWidth={2} /> Home Assistant · {label}
    </span>
  );
}
