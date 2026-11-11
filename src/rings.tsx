import { createMemo, createSignal, For, Show } from "solid-js"
import type { QuotaView } from "./services"
import { quotaRings } from "./quota-rings"

export function QuotaRings(props: { quota?: QuotaView; fallbackValue?: string }) {
  const rings = createMemo(() => quotaRings(props.quota?.rows ?? []))
  const [selected, setSelected] = createSignal<string>()
  const active = () => rings().find((r) => r.key === selected()) ?? rings()[0]
  const date = (value: number | string) => new Date(value).toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
  return <Show when={rings().length} fallback={<div class="atlas-own-usage"><strong>{props.fallbackValue ?? "—"}</strong><span>累计用量</span></div>}>
    <div class="atlas-quota-center">
      <div class="atlas-rings" aria-label="模型来源额度同心环">
        <svg viewBox="0 0 220 220" aria-label="点击环查看该来源的精确数据">
          <For each={rings()}>{(ring, i) => {
            const radius = () => 98 - i() * Math.min(14, 50 / Math.max(1, rings().length - 1))
            const circumference = () => 2 * Math.PI * radius()
            return <g role="button" tabindex="0" aria-label={`${ring.label} ${ring.value}`} aria-pressed={active()?.key === ring.key} onClick={(e) => { e.stopPropagation(); setSelected(ring.key) }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setSelected(ring.key) } }}>
              <title>{ring.label} · {ring.value} · 点击查看各周期</title>
              <circle class="atlas-ring-outline" cx="110" cy="110" r={radius()} fill="none" stroke-width="8" />
              <circle cx="110" cy="110" r={radius()} fill="none" stroke={ring.color} stroke-opacity=".18" stroke-width="5" />
              <circle cx="110" cy="110" r={radius()} fill="none" stroke={ring.color} stroke-width={active()?.key === ring.key ? 6 : 5} stroke-linecap="round" stroke-dasharray={ring.percent === undefined ? "2 7" : `${circumference()} ${circumference()}`} stroke-dashoffset={ring.percent === undefined ? 0 : circumference() * (1 - Math.max(0, Math.min(100, ring.percent)) / 100)} transform="rotate(-90 110 110)" style={{ filter: `drop-shadow(0 0 3px ${ring.color}66)` }} />
              <circle cx="110" cy="110" r={radius()} fill="none" stroke="transparent" stroke-width="12" />
            </g>
          }}</For>
        </svg>
        <div class="atlas-ring-value"><span>{active()?.label}</span><strong>{active()?.value}</strong><small>{active()?.percent === undefined ? "余额" : "最低剩余"}</small></div>
      </div>
      <div class="atlas-ring-readout" aria-live="polite"><strong>{active()?.label}</strong><For each={active()?.rows ?? []}>{(row) => <div><span>{row.label}</span><b>{row.value}</b><small>{row.resetAt ? `重置 ${date(row.resetAt)}` : ""}{row.checkedAt ? ` · ${date(row.checkedAt)} 更新` : ""}</small><Show when={row.status?.includes("失败")}><small>{row.status}</small></Show></div>}</For></div>
    </div>
  </Show>
}
