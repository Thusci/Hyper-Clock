"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";

export type Enrollment = { ticket: string; uri: string; secret: string; qrSvg: string };

export const csrf = () => decodeURIComponent(document.cookie.split("; ").find((value) => value.startsWith("hc_csrf="))?.split("=")[1] ?? "");

/** QR code + manual key + confirmation code. Calls onDone once the server accepted the new authenticator. */
export function TotpEnroll({ enrollment, purpose, onDone, onRestart }: { enrollment: Enrollment; purpose: "setup" | "renew"; onDone: () => void; onRestart: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function confirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError("");
    const response = await fetch("/api/auth/totp/verify", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf() },
      body: JSON.stringify({ ticket: enrollment.ticket, code, purpose }),
    });
    if (response.ok) { onDone(); return; }
    setError((await response.json().catch(() => ({}))).error ?? "验证失败");
    setBusy(false);
  }

  return (
    <form onSubmit={confirm} className="space-y-5">
      <ol className="m-0 space-y-1 pl-5 text-sm text-[var(--muted)]">
        <li>用身份验证器 App（Google / Microsoft Authenticator、1Password 等）扫描二维码</li>
        <li>输入 App 显示的 6 位验证码完成绑定</li>
      </ol>
      <div className="mx-auto w-full max-w-[220px] overflow-hidden rounded-2xl bg-white p-2 [&_svg]:block [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: enrollment.qrSvg }} />
      <details className="text-xs text-[var(--muted)]">
        <summary className="cursor-pointer">无法扫码？手动输入密钥</summary>
        <code className="mt-2 block select-all break-all rounded-xl bg-black/30 p-3 text-sm tracking-wider text-white">{enrollment.secret}</code>
      </details>
      <label className="block text-sm text-[var(--muted)]">验证码
        <input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} required inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" placeholder="000000" className="field mt-2 text-center font-mono text-2xl tracking-[.4em]" />
      </label>
      {error && <p role="alert" className="m-0 text-sm text-[var(--red)]">{error} <button type="button" onClick={onRestart} className="underline">重新开始</button></p>}
      <button type="submit" disabled={busy || code.length !== 6} className="focus-ring flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3.5 font-semibold text-black disabled:opacity-40"><ShieldCheck size={18} />{busy ? "正在验证…" : "确认绑定"}</button>
    </form>
  );
}
