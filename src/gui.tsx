import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { Command, MenuItem, Panel, Plugin, SettingsPage, Slot, Style, type PanelTab } from "@opencode/plugin/gui"
import type { Data } from "@opencode/client/solid"
import { rootOf, type Packet } from "./state"
import { Traffic } from "./traffic"
import { Artifacts } from "./artifacts"
import { AgentPanel } from "./monitor"
import { main } from "./backend"
import { AnalyzerSettings } from "./settings"
import { RadarBridge } from "./services"
import { analysisRequest } from "./analysis-request"
import css from "./panel.css?inline"

function FullScreen(props: { close: () => void; children: import("solid-js").JSX.Element }) {
  let element!: HTMLDivElement
  const prior = document.activeElement as HTMLElement | null
  onMount(() => element.focus())
  onCleanup(() => prior?.isConnected && prior.focus())
  return <Portal><div ref={element} class="atlas-fullscreen" role="dialog" aria-modal="true" aria-label="Agent Radar 大屏总控台" tabindex="-1" onKeyDown={(e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); props.close() }
    if (e.key === "Tab") {
      const targets = [...element.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, [tabindex="0"]')]
      const first = targets[0], last = targets.at(-1)
      if (e.shiftKey && (document.activeElement === first || document.activeElement === element)) { e.preventDefault(); last?.focus() }
      else if (!e.shiftKey && (document.activeElement === last || document.activeElement === element)) { e.preventDefault(); first?.focus() }
    }
  }}>{props.children}</div></Portal>
}

export default Plugin.define({
  main,
  setup(ctx) {
    const [fullscreen, setFullscreen] = createSignal(false)
    createEffect(() => { if (!ctx.sessions.current()) setFullscreen(false) })
    const [buffers, setBuffers] = createSignal<Record<string, Packet[]>>({})
    const listeners = new Map<string, { data: Data; stop: () => void }>()
    const analysisTimers = new Map<string, ReturnType<typeof setTimeout>>()
    const analyzeFiles = (id: string, data: Data, added: Packet[]) => {
      const roots = new Set(added.filter((p) => p.kind === "artifact" || p.kind === "file").map((p) => rootOf(p.from, data.session.list())))
      for (const root of roots) {
        const key = `${id}:${root}`
        if (analysisTimers.has(key)) continue
        if (analysisTimers.size >= 32) { const first = analysisTimers.keys().next().value!; clearTimeout(analysisTimers.get(first)); analysisTimers.delete(first) }
        analysisTimers.set(key, setTimeout(() => {
          analysisTimers.delete(key)
          if (ctx.servers.get(id)?.data !== data || !data.session.get(root)) return
          try { void ctx.main(RadarBridge).analyze(analysisRequest(id, root, data, buffers()[id] ?? [])).catch(() => {}) } catch { /* A cold cache can be retried on the next event or visible-panel scan. */ }
        }, 1000))
      }
    }
    createEffect(() => {
      const serverIDs = new Set([...ctx.servers.list(), ...ctx.sessions.list().map((s) => s.server.id)])
      const current = ctx.sessions.current()
      if (current) serverIDs.add(current.server.id)
      for (const id of serverIDs) {
        const data = ctx.servers.get(id)?.data
        if (!data || listeners.get(id)?.data === data) continue
        listeners.get(id)?.stop()
        const lookup = (sid: string) => data.session.get(sid)
        const tool = (sid: string, mid: string, tid: string) => {
          const m = data.session.message.get(sid, mid)
          return m?.type === "assistant" ? m.content.find((c) => c.type === "tool" && c.id === tid) as import("@opencode/client").SessionMessageAssistantTool | undefined : undefined
        }
        const tracker = new Traffic(lookup, tool), artifacts = new Artifacts(lookup, tool)
        const delivered = new Set<string>()
        const append = (added: Packet[]) => {
          if (!added.length) return
          setBuffers((old) => {
            const unique = new Map((old[id] ?? []).map((p) => [p.id, p]))
            for (const p of added) if (!unique.has(p.id)) unique.set(p.id, p.inboxID && delivered.has(`${p.to}:${p.inboxID}`) ? { ...p, stage: "已送达", deliveredAt: Date.now() } : p)
            const trees = new Map<string, Packet[]>()
            const sessions = data.session.list(), roots = new Map<string, string>()
            for (const p of unique.values()) {
              const root = roots.get(p.from) ?? rootOf(p.from, sessions), tree = trees.get(root) ?? []
              roots.set(p.from, root)
              tree.push(p); trees.set(root, tree.slice(-160))
            }
            return { ...old, [id]: [...trees.values()].flat().sort((a, b) => (a.seenAt ?? a.at) - (b.seenAt ?? b.at)).slice(-3200) }
          })
          analyzeFiles(id, data, added)
        }
        const stop = data.listen(({ details }) => {
          append([...tracker.accept(details), ...artifacts.accept(details)])
          if (details.type === "session.inbox.delivered") {
            delivered.add(`${details.data.sessionID}:${details.data.inboxID}`)
            if (delivered.size > 2000) delivered.delete(delivered.values().next().value!)
            setBuffers((old) => (old[id] ?? []).some((p) => p.inboxID === details.data.inboxID && p.to === details.data.sessionID && p.stage !== "已送达")
              ? { ...old, [id]: old[id].map((p) => p.inboxID === details.data.inboxID && p.to === details.data.sessionID ? { ...p, stage: "已送达", deliveredAt: Date.now() } : p) } : old)
          }
        })
        const retry = setInterval(() => append([...tracker.flush(), ...artifacts.flush()]), 300)
        listeners.set(id, { data, stop: () => { stop(); clearInterval(retry) } })
      }
      for (const [id, listener] of listeners) if (!serverIDs.has(id)) { listener.stop(); listeners.delete(id); setBuffers((old) => { const next = { ...old }; delete next[id]; return next }) }
    })
    onCleanup(() => { for (const listener of listeners.values()) listener.stop(); for (const timer of analysisTimers.values()) clearTimeout(timer); analysisTimers.clear() })
    ctx.add(Style, css)
    ctx.add(SettingsPage, { id: ctx.id, title: "Agent Radar", icon: "settings-gear", entries: [{ id: "analyzer-mode", title: "逻辑分析 API Key", keywords: "Kimi API model key 模型 密钥" }], render: () => <AnalyzerSettings ctx={ctx} /> })
    const tab: PanelTab = { id: "radar", title: "总控台 · Agent Radar", closable: "compact", fallback: true }
    ctx.add(Panel, {
      id: "radar", region: "side", width: 1000, wide: true,
      list: ({ open }) => open.includes("radar") ? [tab] : [],
      render: (props) => <AgentPanel ctx={ctx} session={props.session} packets={() => buffers()[props.session.server.id] ?? []} onFullscreen={() => setFullscreen(true)} />,
    })
    const open = () => { if (ctx.sessions.current()) setFullscreen(true) }
    ctx.add(Command, (): Command => ({ id: "open", title: "打开大屏总控台 · Agent Radar", keywords: "agents subagents monitor radar 子代理 总控台 思维导图", slash: { name: "radar" }, bind: "mod+shift+j", enabled: !!ctx.sessions.current(), run: open }))
    ctx.add(MenuItem, (): MenuItem => ({ menu: "session.panel", id: "radar", title: "总控台 · Agent Radar", run: () => { const s = ctx.sessions.current(); if (s) ctx.layout.open(`${ctx.id}:radar`, s) } }))
    ctx.add(Slot, { at: "session.header", order: 90, render: () => <button class="atlas-launch" onClick={open}>总控台 ↗</button> })
    ctx.add(Slot, { at: "window.bottom", render: () => <Show when={fullscreen() && ctx.sessions.current()}>{(s) => <FullScreen close={() => setFullscreen(false)}><AgentPanel ctx={ctx} session={s()} packets={() => buffers()[s().server.id] ?? []} fullscreen onFullscreen={open} onClose={() => setFullscreen(false)} /></FullScreen>}</Show> })
  },
})
