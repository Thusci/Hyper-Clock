"use client";

import { Mic, X } from "lucide-react";

export function VoiceOverlay({ configured, onClose }: { configured: boolean; onClose: () => void }) {
  return (
    <section className="voice-overlay fixed inset-0 z-50 grid place-items-center" role="status" aria-live="assertive" onPointerDown={onClose}>
      <button className="focus-ring absolute right-8 top-8 grid size-11 place-items-center rounded-full border border-white/15 bg-black/20 text-white/70" onClick={onClose} aria-label="关闭语音聆听"><X size={19} /></button>
      <div className="text-center">
        <div className="voice-orb relative mx-auto grid size-[clamp(11rem,20vw,17rem)] place-items-center rounded-full">
          <i className="voice-ring voice-ring-a" />
          <i className="voice-ring voice-ring-b" />
          <Mic className="relative z-10 text-white" size={48} strokeWidth={1.7} />
        </div>
        <h2 className="mb-0 mt-10 font-display text-[clamp(2.5rem,5vw,4.8rem)] font-semibold tracking-[-.055em] text-white">我在听</h2>
        <p className="mt-4 text-base text-white/55">{configured ? "说出你的指令" : "语音服务尚未配置"}</p>
        <div className="voice-bars mx-auto mt-8 flex h-8 w-44 items-center justify-center gap-1.5" aria-hidden="true">
          {Array.from({ length: 9 }, (_, index) => <i key={index} style={{ animationDelay: `${index * 70}ms` }} />)}
        </div>
      </div>
    </section>
  );
}
