import { Droplets, Gauge, Radio, ThermometerSun, Zap } from "lucide-react";
import type { AppConfig, HassEntityMap } from "@/types/config";
import { PageHeader } from "./page-header";

const icons = [ThermometerSun, Droplets, Zap, Gauge];

export function SensorsPage({ config, entities }: { config: AppConfig; entities: HassEntityMap }) {
  return (
    <section className="sensors-page h-full" aria-label="环境传感器">
      <PageHeader kicker="Sensors · 实时感知" title="家的呼吸" tone="green" />
      <div className="sensors-grid grid min-h-0 grid-cols-3 gap-5 overflow-y-auto" data-no-swipe>
        {!config.entities.sensors.length && <div className="glass col-span-full grid place-items-center rounded-[var(--r-xl)] text-center"><div><Radio className="mx-auto text-[var(--muted)]" size={28} /><b className="mt-4 block">尚未绑定传感器</b><span className="mt-2 block text-sm text-[var(--muted)]">请在后台表盘编辑器中填写 HA 传感器实体</span></div></div>}
        {config.entities.sensors.map((id, index) => {
          const entity = entities[id];
          const Icon = icons[index % icons.length];
          return (
            <article key={id} className="glass sensor-card flex min-h-0 flex-col justify-between overflow-hidden rounded-[var(--r-xl)] p-7">
              <div className="flex min-w-0 items-start justify-between gap-3"><span className="sensor-name text-sm text-[var(--muted)]">{entity?.attributes.friendly_name ?? id}</span><Icon size={21} className="shrink-0 text-[var(--green)]" /></div>
              <div className="sensor-reading min-w-0">
                <strong className="sensor-value font-display font-medium tracking-[-.07em] tabular-nums">{entity?.state ?? "--"}</strong>
                <span className="ml-2 text-lg text-[var(--muted)]">{entity?.attributes.unit_of_measurement as string ?? ""}</span>
              </div>
              <p className="mb-0 text-xs text-[var(--muted)]">{entity?.last_changed ? `更新于 ${new Date(entity.last_changed).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}` : "等待 HA 更新"}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
