"use client";

import { useState } from "react";
import { Plus, RefreshCw, Trash2, UserRound } from "lucide-react";

type User = { username: string; role: "admin" | "viewer"; disabled?: boolean; createdAt: string };
type Session = { id: string; username: string; createdAt: string; expiresAt: string };
const csrf = () => decodeURIComponent(document.cookie.split("; ").find((v) => v.startsWith("hc_csrf="))?.split("=")[1] ?? "");

export function UserManager({ current, initialUsers, initialSessions }: { current: string; initialUsers: User[]; initialSessions: Session[] }) {
  const [users, setUsers] = useState(initialUsers);
  const [sessions, setSessions] = useState(initialSessions);
  const [error, setError] = useState("");
  async function load() {
    const [nextUsers, nextSessions] = await Promise.all([fetch("/api/admin/users").then((r) => r.json()), fetch("/api/admin/sessions").then((r) => r.json())]);
    setUsers(nextUsers); setSessions(nextSessions);
  }
  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    const response = await fetch("/api/admin/users", { method: "PUT", headers: { "content-type": "application/json", "x-csrf-token": csrf() }, body: JSON.stringify({ username: data.get("username"), password: data.get("password"), role: data.get("role") }) });
    if (!response.ok) setError(JSON.stringify((await response.json()).error)); else { form.reset(); await load(); }
  }
  async function remove(username: string) {
    const response = await fetch(`/api/admin/users?username=${encodeURIComponent(username)}`, { method: "DELETE", headers: { "x-csrf-token": csrf() } });
    if (!response.ok) setError((await response.json()).error); else await load();
  }
  async function revoke(id: string) { await fetch(`/api/admin/sessions?id=${encodeURIComponent(id)}`, { method: "DELETE", headers: { "x-csrf-token": csrf() } }); await load(); }
  return <div>
    <header><p className="mb-2 text-sm text-[var(--blue)]">安全</p><h2 className="m-0 font-display text-4xl font-semibold tracking-[-.05em]">用户与权限</h2><p className="text-sm text-[var(--muted)]">账号、角色和活跃会话集中管理</p></header>
    {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-[var(--red)]">{error}</p>}
    <div className="mt-8 grid gap-5 xl:grid-cols-[1fr_.75fr]">
      <section className="rounded-3xl border border-white/10 p-5"><h3 className="mt-0">账号</h3><div className="space-y-2">{users.map((user) => <div key={user.username} className="flex items-center justify-between rounded-2xl bg-white/[.035] p-4"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-full bg-white/[.06]"><UserRound size={18} /></span><div><b className="block text-sm">{user.username}</b><span className="text-xs text-[var(--muted)]">{user.role === "admin" ? "管理员" : "只读"}{user.disabled ? " · 已禁用" : ""}</span></div></div><button disabled={user.username === current} onClick={() => remove(user.username)} className="p-2 text-[var(--red)] disabled:opacity-20"><Trash2 size={17} /></button></div>)}</div>
        <form onSubmit={add} className="mt-6 grid gap-3 border-t border-white/10 pt-5 sm:grid-cols-2"><input name="username" required minLength={3} placeholder="新账号或现有账号" className="field" /><input name="password" type="password" required minLength={12} placeholder="至少 12 位新密码" className="field" /><select name="role" className="field"><option value="viewer">只读</option><option value="admin">管理员</option></select><button className="flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black"><Plus size={16} />创建或更新</button></form>
      </section>
      <section className="rounded-3xl border border-white/10 p-5"><h3 className="mt-0">活跃会话</h3><div className="space-y-2">{sessions.map((session) => <div key={session.id} className="rounded-2xl bg-white/[.035] p-4"><div className="flex justify-between"><b className="text-sm">{session.username}</b><button onClick={() => revoke(session.id)} className="text-xs text-[var(--red)]"><RefreshCw size={13} className="mr-1 inline" />强制下线</button></div><p className="mb-0 text-xs text-[var(--muted)]">登录于 {new Date(session.createdAt).toLocaleString("zh-CN")}<br />到期 {new Date(session.expiresAt).toLocaleString("zh-CN")}</p></div>)}</div></section>
    </div>
  </div>;
}
