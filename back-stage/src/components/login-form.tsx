"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { csrf, TotpEnroll, type Enrollment } from "./totp-enroll";

type Method = "password" | "totp";
/** totp mode: "code" → (not enrolled) "password" → "enroll". */
type Step = "code" | "password" | "enroll";

export function LoginForm({ method }: { method: Method }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("code");
  const [username, setUsername] = useState("");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const enter = () => { router.replace("/admin"); router.refresh(); };

  async function post(url: string, body: unknown) {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf() }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, data };
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (method === "totp" && step === "password") {
      const { ok, data } = await post("/api/auth/totp/setup", { username, password });
      if (ok) { setEnrollment(data); setStep("enroll"); } else setError(data.error ?? "验证失败");
    } else {
      const { ok, data } = await post("/api/auth/login", method === "totp" ? { username, code: form.get("code") } : { username, password });
      if (ok && data.setupRequired) { setStep("password"); setError(""); }
      else if (ok) { enter(); return; }
      else setError(data.error ?? "登录失败");
    }
    setBusy(false);
  }

  const restart = () => { setStep("code"); setEnrollment(null); setError(""); };
  const title = step === "enroll" ? "绑定身份验证器" : step === "password" ? "首次登录" : "控制中心";

  return (
    <div className="admin-glass w-full max-w-md rounded-[2.2rem] p-8">
      <span className="mb-8 grid size-12 place-items-center rounded-2xl bg-[var(--blue)] text-black"><LockKeyhole size={22} /></span>
      <p className="mb-2 text-xs font-semibold tracking-[.18em] text-[var(--blue)]">HYPER CLOCK</p>
      <h1 className="mb-8 mt-0 font-display text-4xl font-semibold tracking-[-.05em]">{title}</h1>
      {step === "enroll" && enrollment ? (
        <TotpEnroll enrollment={enrollment} purpose="setup" onDone={enter} onRestart={restart} />
      ) : (
        <form onSubmit={submit}>
          {step === "password" && <p className="mt-0 text-sm text-[var(--muted)]">账号 <b className="text-white">{username}</b> 还没有绑定身份验证器。输入账号密码（环境文件中的引导密码，或 <code>launch.sh --reset-user</code> 生成的密码）开始绑定。</p>}
          <label className="mb-5 block text-sm text-[var(--muted)]">账号
            <input name="username" required autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} readOnly={step === "password"} className="field mt-2" />
          </label>
          {method === "totp" && step === "code" ? (
            <label className="block text-sm text-[var(--muted)]">验证码
              <input name="code" required inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} placeholder="身份验证器中的 6 位数字" className="field mt-2 font-mono tracking-[.3em]" />
            </label>
          ) : (
            <label className="block text-sm text-[var(--muted)]">密码
              <input name="password" required type="password" autoComplete="current-password" className="field mt-2" />
            </label>
          )}
          {error && <p role="alert" className="mt-4 text-sm text-[var(--red)]">{error}</p>}
          <button type="submit" disabled={busy} className="focus-ring mt-6 flex w-full items-center justify-between rounded-2xl bg-white px-5 py-3.5 font-semibold text-black disabled:opacity-40">{busy ? "正在验证…" : step === "password" ? "下一步" : "安全登录"}<ArrowRight size={18} /></button>
          {step === "password" && <button type="button" onClick={restart} className="mt-3 w-full text-xs text-[var(--muted)]">返回</button>}
          {method === "totp" && step === "code" && <button type="button" onClick={() => { setStep("password"); setError(""); }} disabled={!username} className="mt-3 w-full text-xs text-[var(--muted)] disabled:opacity-40">还没有绑定身份验证器？先填写账号，然后点此用密码绑定</button>}
        </form>
      )}
    </div>
  );
}
