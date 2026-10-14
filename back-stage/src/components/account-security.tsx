"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, RefreshCw, ShieldCheck, Smartphone } from "lucide-react";
import { csrf, TotpEnroll, type Enrollment } from "./totp-enroll";

export function AccountSecurity({ username, method, totp }: { username: string; method: "password" | "totp"; totp: boolean }) {
  const router = useRouter();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function begin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    const response = await fetch("/api/auth/totp/renew", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf() }, body: JSON.stringify({ code }) });
    const data = await response.json().catch(() => ({}));
    if (response.ok) setEnrollment(data); else setError(data.error ?? "操作失败");
    setBusy(false);
  }

  function done() {
    setEnrollment(null); setCode("");
    setNotice("新的身份验证器已生效，旧的验证码从现在起失效。");
    router.refresh();
  }

  return (
    <div>
      <header><p className="mb-2 text-sm text-[var(--blue)]">安全</p><h2 className="m-0 font-display text-4xl font-semibold tracking-[-.05em]">账户安全</h2><p className="text-sm text-[var(--muted)]">{username} 的登录方式与身份验证器</p></header>
      <div className="mt-8 grid max-w-4xl gap-5 lg:grid-cols-2">
        <section className="rounded-3xl border border-white/10 p-5">
          <h3 className="mt-0 flex items-center gap-2"><KeyRound size={18} />登录方式</h3>
          <p className="text-sm">{method === "totp" ? "账号 + 身份验证器验证码" : "账号 + 密码"}</p>
          <p className="mb-0 text-xs leading-5 text-[var(--muted)]">由环境文件中的 <code>AUTH_METHOD</code>（<code>password</code> 或 <code>totp</code>）决定，修改后重启 back-stage 生效。忘记密码或丢失手机时，在 Q775 上运行 <code>sudo scripts/launch.sh --reset-user {username}</code>。</p>
        </section>
        <section className="rounded-3xl border border-white/10 p-5">
          <h3 className="mt-0 flex items-center gap-2"><Smartphone size={18} />身份验证器</h3>
          <p className="flex items-center gap-2 text-sm">{totp ? <><ShieldCheck size={16} className="text-[var(--green)]" />已绑定</> : "未绑定"}</p>
          {notice && <p className="rounded-xl bg-emerald-500/10 p-3 text-sm text-[var(--green)]">{notice}</p>}
          {enrollment ? (
            <TotpEnroll enrollment={enrollment} purpose="renew" onDone={done} onRestart={() => { setEnrollment(null); setError(""); }} />
          ) : (
            <form onSubmit={begin} className="space-y-3">
              <p className="m-0 text-xs leading-5 text-[var(--muted)]">{totp ? "更换手机或怀疑密钥泄露时重新生成。需要输入当前验证码；确认新验证码之前旧的仍然有效。" : method === "totp" ? "绑定后即可用验证码登录。" : "可以提前绑定，切换到 AUTH_METHOD=totp 后直接使用。"}</p>
              {totp && <input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} required inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" placeholder="当前 6 位验证码" className="field font-mono tracking-[.3em]" />}
              {error && <p role="alert" className="m-0 text-sm text-[var(--red)]">{error}</p>}
              <button type="submit" disabled={busy || (totp && code.length !== 6)} className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black disabled:opacity-40"><RefreshCw size={16} />{totp ? "重新生成验证器" : "绑定身份验证器"}</button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
