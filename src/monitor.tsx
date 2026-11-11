import { createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js"
import type { Context, MountedSession } from "@opencode/plugin/gui"
import { discoverChildren } from "./family"
import { elapsed, familyOf, rootOf, runState, scopedPackets, totalTokens, type Packet } from "./state"
import { MindMap, type MapNode } from "./map"
import { RadarBridge, type AnalysisView, type QuotaView } from "./services"
import { analysisRequest } from "./analysis-request"
import { analysisFamily } from "./analysis-family"
import { mergePackets, publicHistory } from "./public-history"

const idleAnalysis = (): AnalysisView => ({ state: "idle", updatedAt: 0, summary: "等待分析任务关系。", edges: [] })
export function AgentPanel(props: { ctx: Context; session: MountedSession; packets: () => Packet[]; fullscreen?: boolean; onFullscreen: () => void; onClose?: () => void }) {
  const [now, setNow] = createSignal(Date.now())
  const [notice, setNotice] = createSignal("")
  const [analysis, setAnalysis] = createSignal<AnalysisView>(idleAnalysis())
  const [quota, setQuota] = createSignal<QuotaView>({ updatedAt: 0, state: "ready", rows: [] })
  const data = () => props.session.server.data
  const root = createMemo(() => { const id = rootOf(props.session.id, data().session.list()); return data().session.get(id) ? id : props.session.id })
  const family = createMemo(() => familyOf(root(), data().session.list()))
  const history = () => publicHistory(data()).view(root())
  const traffic = createMemo(() => scopedPackets(mergePackets(history().packets, props.packets()), new Set(family().map((s) => s.id))))
  const nodes = createMemo<MapNode[]>(() => [...family()].sort((a, b) => Number(b.id === root()) - Number(a.id === root()) || a.time.created - b.time.created || a.id.localeCompare(b.id)).map((info) => {
    const running = data().session.status(info.id) === "running"
    const waiting = (data().session.permission.list(info.id)?.length ?? 0) > 0 || (data().session.form.list(info.id, info.location)?.length ?? 0) > 0
    const assistant = [...data().session.message.list(info.id)].reverse().find((message) => message.type === "assistant")
    const current = assistant && assistant.time.created >= (info.time.busy ?? 0) ? assistant : undefined
    const model = (running ? current?.model : undefined) ?? info.model ?? assistant?.model
    return { id: info.id, parentID: info.parentID, name: current?.agent ?? info.agent ?? "子代理", title: info.title ?? "会话任务", model: model ? `${model.id}${model.variant ? ` · ${model.variant}` : ""}` : "模型同步中", state: runState(info, running, waiting), elapsed: elapsed(info, running, now()), tokens: totalTokens(info.tokens) }
  }))
  const open = (id: string) => { props.ctx.tabs.open({ server: props.session.server.id, id }, { focus: true }); if (props.fullscreen) props.onClose?.() }

  createEffect(() => {
    const session = props.session, store = session.server.data, key = session.key
    let disposed = false, busy = false
    const abort = new AbortController()
    untrack(() => { setNotice(""); setAnalysis(idleAnalysis()) })
    const sync = async () => {
      if (busy || disposed) return
      busy = true
      try {
        let id = session.id
        const seen = new Set<string>()
        while (!seen.has(id) && !disposed) {
          seen.add(id); store.session.invalidate(id); await store.session.sync(id)
          const parent = store.session.get(id)?.parentID
          if (!parent) break
          id = parent
        }
        await discoverChildren(id, (input) => session.server.client.session.list(input, { signal: abort.signal }), (info) => { if (!disposed && !store.session.missing(info.id) && (store.session.get(info.id)?.time.updated ?? 0) <= info.time.updated) store.session.remember(info) }, () => disposed)
        if (!disposed) await publicHistory(store).hydrate(id, analysisFamily(id, store, props.packets()), async (sessionID, signal) => (await session.server.client.message.list({ sessionID, type: "assistant", order: "desc", limit: sessionID === id ? 12 : 6 }, { signal })).data, abort.signal)
        if (!disposed && props.session.key === key) setNotice("")
      } catch { if (!disposed) setNotice("数据校准暂不可用，已保留最近状态。") }
      finally { busy = false }
    }
    untrack(() => { void sync() })
    const timer = setInterval(() => { if (!document.hidden) void sync() }, 15000)
    onCleanup(() => { disposed = true; abort.abort(); clearInterval(timer) })
  })

  createEffect(() => {
    const key = props.session.key, analysisRoot = root()
    untrack(() => setAnalysis(idleAnalysis()))
    let disposed = false, scanning = false
    const scan = async () => {
      if (disposed || scanning || document.hidden || nodes().length < 2) return
      scanning = true
      try {
        const result = await props.ctx.main(RadarBridge).analyze(analysisRequest(props.session.server.id, root(), data(), props.packets()))
        if (!disposed && props.session.key === key && root() === analysisRoot) setAnalysis(result)
      } catch { if (!disposed) setAnalysis({ ...idleAnalysis(), state: "error", error: "逻辑分析通道暂不可用" }) }
      finally { scanning = false }
    }
    const start = setTimeout(() => { void scan() }, 1500)
    const timer = setInterval(() => { void scan() }, 4000)
    onCleanup(() => { disposed = true; clearTimeout(start); clearInterval(timer) })
  })
  let gone = false, quotaBusy = false
  const readQuota = async () => {
    if (gone || quotaBusy) return
    quotaBusy = true
    try { const value = await props.ctx.main(RadarBridge).quota(); if (!gone) setQuota(value) }
    catch { if (!gone) setQuota({ updatedAt: 0, state: "error", error: "额度缓存暂不可用", rows: [] }) }
    finally { quotaBusy = false }
  }
  void readQuota()
  const quotaTimer = setInterval(() => { if (!document.hidden) void readQuota() }, 15000)
  const clock = setInterval(() => { if (!document.hidden) setNow(Date.now()) }, 500)
  onCleanup(() => { gone = true; clearInterval(quotaTimer); clearInterval(clock) })

  return <section class="atlas-panel atlas-pure" data-mode={props.ctx.appearance.mode()} classList={{ "atlas-expanded": props.fullscreen }} aria-label="Agent Radar 总控台">
    <div class="atlas-window-actions"><button aria-label="分析 API 设置" title={analysis().error || notice() || "分析 API 设置"} onClick={() => { props.onClose?.(); props.ctx.layout.settings(props.ctx.id) }}>⚙</button><button aria-label={props.fullscreen ? "收起大屏" : "展开大屏"} title={props.fullscreen ? "收起大屏 · Esc" : "展开大屏"} onClick={props.fullscreen ? props.onClose : props.onFullscreen}>{props.fullscreen ? "↙" : "↗"}</button></div>
    <MindMap nodes={nodes()} rootID={root()} layoutKey={`${props.session.server.id}:${root()}`} packets={traffic()} now={now()} onOpen={open} overview compact={!props.fullscreen} quota={quota()} analysis={analysis()} summary={analysis().error || history().error || notice() || analysis().summary} edges={analysis().edges} />
  </section>
}
