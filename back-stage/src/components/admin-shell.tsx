"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Activity, BookOpen, KeyRound, LayoutDashboard, LogOut, Mic2, Settings2, SlidersHorizontal, UsersRound } from "lucide-react";
import type { Role } from "@/types";

const items = [
  { href: "/admin", label: "概览", icon: Activity },
  { href: "/admin/ha-control", label: "HA 控制", icon: SlidersHorizontal },
  { href: "/admin/dashboard-config", label: "表盘编辑", icon: LayoutDashboard },
  { href: "/admin/rules-config", label: "交互规则", icon: Settings2 },
  { href: "/admin/voice-setting", label: "语音助手", icon: Mic2 },
  { href: "/admin/user-management", label: "用户权限", icon: UsersRound, admin: true },
  { href: "/admin/system-log", label: "状态日志", icon: BookOpen },
  { href: "/admin/account", label: "账户安全", icon: KeyRound },
];

function csrf() {
  return decodeURIComponent(document.cookie.split("; ").find((value) => value.startsWith("hc_csrf="))?.split("=")[1] ?? "");
}

export function AdminShell({ children, username, role }: { children: React.ReactNode; username: string; role: Role }) {
  const path = usePathname();
  const router = useRouter();
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", headers: { "x-csrf-token": csrf() } });
    router.replace("/login");
    router.refresh();
  }

  return (
    <main className="admin-bg min-h-dvh p-3 pb-24 lg:p-5 xl:p-6">
      <div className="mx-auto grid w-full max-w-[2200px] lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-4 xl:gap-5">
        <aside className="admin-glass sticky top-5 hidden h-[calc(100dvh-2.5rem)] flex-col rounded-[1.75rem] p-3 lg:flex xl:top-6 xl:h-[calc(100dvh-3rem)]">
          <div className="px-3 py-4"><p className="m-0 text-[10px] font-semibold tracking-[.16em] text-[var(--blue)]">Q775 系统</p><h1 className="mb-0 mt-1 font-display text-xl font-semibold">Hyper Clock</h1></div>
          <nav className="mt-4 space-y-1">{items.filter((item) => !item.admin || role === "admin").map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`focus-ring flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm no-underline transition ${path === href ? "bg-white text-black" : "text-[var(--muted)] hover:bg-white/[.05] hover:text-white"}`}><Icon size={17} />{label}</Link>)}</nav>
          <div className="mt-auto border-t border-white/10 px-3 pt-4"><p className="mb-0 text-sm">{username}</p><p className="mt-1 text-xs text-[var(--muted)]">{role === "admin" ? "管理员" : "只读账号"}</p><button onClick={logout} className="mt-3 flex items-center gap-2 text-xs text-[var(--muted)]"><LogOut size={14} />退出</button></div>
        </aside>
        <section className="admin-glass min-h-[calc(100dvh-1.5rem)] min-w-0 overflow-hidden rounded-[1.75rem] p-4 sm:p-5 lg:min-h-[calc(100dvh-2.5rem)] lg:p-6 xl:min-h-[calc(100dvh-3rem)] xl:p-8">{children}</section>
      </div>
      <nav className="fixed inset-x-3 bottom-3 z-40 flex justify-between gap-1 overflow-x-auto rounded-2xl border border-white/10 bg-[#15181e]/90 p-2 backdrop-blur-2xl lg:hidden">{items.filter((item) => !item.admin || role === "admin").map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`flex min-w-14 shrink-0 flex-col items-center gap-1 rounded-xl px-2 py-2 text-[10px] no-underline ${path === href ? "bg-white text-black" : "text-white/55"}`}><Icon size={17} />{label}</Link>)}</nav>
    </main>
  );
}
