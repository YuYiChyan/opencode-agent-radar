import { createSignal } from "solid-js"
import type { Data } from "@opencode/client/solid"
import type { SessionInfo, SessionMessageInfo } from "@opencode/client"
import { short, type Packet } from "./state"

type Note = { id: string; at: number; text: string }
export type Projection = { tasks: Note[]; outputs: Note[]; packets: Packet[] }
export type HistoryView = { summaries: Record<string, string>; packets: Packet[]; loaded: string[]; error?: string }
const empty = (): HistoryView => ({ summaries: {}, packets: [], loaded: [] })

// Deliberately project only completed public text and verified subagent tool fields.
// Reasoning/native/user/synthetic records never enter this projection.
export function projectHistory(info: SessionInfo, messages: readonly SessionMessageInfo[], family: readonly SessionInfo[]): Projection {
  const byID = new Map(family.map((n) => [n.id, n])), result: Projection = { tasks: [], outputs: [], packets: [] }
  if (!byID.has(info.id)) return result
  for (const message of messages) {
    if (message.type !== "assistant") continue
    if (message.time.completed && !message.error && message.finish === "stop" && message.time.created >= (info.time.busy ?? 0)) {
      const text = short(message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n"), 520)
      if (text) result.outputs.push({ id: info.id, at: message.time.completed, text })
    }
    for (const tool of message.content) {
      if (tool.type !== "tool" || tool.name !== "subagent" || tool.state.status !== "completed") continue
      const state = tool.state, target = state.metadata?.sessionID ?? state.input.sessionID
      if (typeof target !== "string" || target === info.id || !byID.has(target)) continue
      const at = tool.time.completed ?? tool.time.created
      const task = short(state.input.description, 360)
      if (task) result.tasks.push({ id: target, at, text: task })
      result.packets.push({ id: `${info.id}:${tool.id}:dispatch`, from: info.id, to: target, at, seenAt: 0,
        kind: byID.get(target)!.parentID !== info.id ? "relay" : "dispatch", label: byID.get(target)!.parentID !== info.id ? "跨代理传递" : state.input.sessionID ? "续派任务" : "派遣任务", summary: task, evidence: "history.tool.completed" })
      const status = state.metadata?.status
      if (status !== "completed" && !(status === undefined && state.input.background !== true)) continue
      const text = short(state.content.filter((part) => part.type === "text").map((part) => part.text).join("\n"), 600)
      result.packets.push({ id: `${info.id}:${tool.id}:result`, from: target, to: info.id, at, seenAt: 0, kind: "result", label: "结果返回", summary: text, evidence: "history.tool.completed" })
    }
  }
  return result
}

type Entry = { at: number; stamp: string; value: Projection }
type Root = { entries: Map<string, Entry>; busy?: Promise<void>; membership: string; revision: number }
const stores = new WeakMap<Data, ReturnType<typeof makeHistory>>()

class HistoryReadStopped extends Error {}
export function readHistoryBounded<T>(run: (signal: AbortSignal) => Promise<T>, signal: AbortSignal, timeout = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController()
    let settled = false, timer: ReturnType<typeof setTimeout> | undefined
    const finish = (error?: unknown, value?: T) => {
      if (settled) return
      settled = true; clearTimeout(timer); signal.removeEventListener("abort", cancel)
      if (error) reject(error); else resolve(value!)
    }
    const cancel = () => { controller.abort(); finish(new HistoryReadStopped("公开摘要读取已取消")) }
    signal.addEventListener("abort", cancel, { once: true })
    if (signal.aborted) { cancel(); return }
    timer = setTimeout(() => { controller.abort(); finish(new HistoryReadStopped("公开摘要读取超时")) }, timeout)
    void Promise.resolve().then(() => { if (controller.signal.aborted) throw new HistoryReadStopped("公开摘要读取已取消"); return run(controller.signal) }).then((value) => finish(undefined, value), (error) => finish(error))
  })
}

export function publicHistory(data: Data) {
  let store = stores.get(data)
  if (!store) { store = makeHistory(); stores.set(data, store) }
  return store
}

function makeHistory() {
  const roots = new Map<string, Root>()
  const [views, setViews] = createSignal<Record<string, HistoryView>>({})
  return {
    view: (root: string): HistoryView => views()[root] ?? empty(),
    async hydrate(rootID: string, family: readonly SessionInfo[], load: (id: string, signal: AbortSignal) => Promise<readonly SessionMessageInfo[]>, signal: AbortSignal) {
      let root = roots.get(rootID)
      if (!root) {
        if (roots.size >= 16) {
          const oldest = [...roots].find(([, item]) => !item.busy)
          if (oldest) { roots.delete(oldest[0]); setViews((v) => { const next = { ...v }; delete next[oldest[0]]; return next }) }
          else return
        }
        root = { entries: new Map(), membership: "", revision: 0 }; roots.set(rootID, root)
      }
      if (root.busy) return root.busy
      const state = root, now = Date.now(), ids = new Set(family.map((n) => n.id))
      const membership = [...ids].sort().join("\n")
      if (state.membership !== membership) { state.membership = membership; state.revision++ }
      const stamp = (info: SessionInfo) => `${state.revision}:${info.time.busy ?? 0}:${info.outcome ?? ""}`
      for (const id of state.entries.keys()) if (!ids.has(id)) state.entries.delete(id)
      const candidates = [...family].sort((a, b) => Number(state.entries.has(a.id)) - Number(state.entries.has(b.id)))
        .filter((info) => { const e = state.entries.get(info.id); return !e || e.stamp !== stamp(info) || now - e.at > 60000 }).slice(0, 32)
      let cursor = 0, failed = false, stopped = false
      const work = async () => {
        while (!signal.aborted && !stopped && cursor < candidates.length) {
          const info = candidates[cursor++]!
          try {
            const messages = await readHistoryBounded((bounded) => load(info.id, bounded), signal)
            if (!signal.aborted) state.entries.set(info.id, { at: Date.now(), stamp: stamp(info), value: projectHistory(info, messages, family) })
          } catch (error) { if (!signal.aborted) failed = true; if (error instanceof HistoryReadStopped) stopped = true }
        }
      }
      state.busy = (async () => {
        await Promise.all([work(), work()])
        if (signal.aborted) return
        const tasks = new Map<string, Note>(), outputs = new Map<string, Note>(), packets = new Map<string, Packet>()
        for (const entry of state.entries.values()) {
          for (const note of entry.value.tasks) if (ids.has(note.id) && (!tasks.has(note.id) || tasks.get(note.id)!.at < note.at)) tasks.set(note.id, note)
          for (const note of entry.value.outputs) if (ids.has(note.id) && (!outputs.has(note.id) || outputs.get(note.id)!.at < note.at)) outputs.set(note.id, note)
          for (const p of entry.value.packets) if (ids.has(p.from) && ids.has(p.to)) packets.set(p.id, p)
        }
        const summaries: Record<string, string> = {}
        for (const id of ids) summaries[id] = short([tasks.has(id) ? `任务：${tasks.get(id)!.text}` : "", outputs.has(id) ? `公开输出：${outputs.get(id)!.text}` : ""].filter(Boolean).join("\n"), 700)
        setViews((v) => ({ ...v, [rootID]: { summaries, packets: [...packets.values()].sort((a, b) => a.at - b.at).slice(-160), loaded: [...state.entries.keys()], ...(failed ? { error: "部分公开摘要暂不可用" } : {}) } }))
      })().finally(() => { state.busy = undefined })
      return state.busy
    },
  }
}

export function mergePackets(history: readonly Packet[], live: readonly Packet[]) {
  const byID = new Map(history.map((p) => [p.id, p]))
  for (const p of live) byID.set(p.id, p)
  return [...byID.values()].sort((a, b) => a.at - b.at).slice(-240)
}
