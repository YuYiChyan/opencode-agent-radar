import type { OpenCodeEvent, SessionMessageAssistantTool, SessionInfo } from "@opencode/client"
import { short, type Packet } from "./state"

type Call = { name: string; input?: Record<string, unknown>; target?: string; sent?: boolean }
type Lookup = (id: string) => SessionInfo | undefined

// This adapter follows public V2 events. A status broadcast and a delivered
// report have distinct labels; background launch acknowledgements stay dispatches.
export class Traffic {
  private calls = new Map<string, Call>()
  private names = new Map<string, string>()
  private seen = new Set<string>()
  private reportRoutes = new Set<string>()
  private pending = new Map<string, { event: OpenCodeEvent; since: number }>()
  constructor(
    private lookup: Lookup,
    private tool: (session: string, message: string, id: string) => SessionMessageAssistantTool | undefined,
  ) {}

  accept(event: OpenCodeEvent): Packet[] {
    if (this.seen.has(event.id)) return []
    const packets = this.handle(event)
    if (packets === undefined) {
      if (!this.pending.has(event.id)) this.pending.set(event.id, { event, since: Date.now() })
      if (this.pending.size > 500) this.pending.delete(this.pending.keys().next().value!)
      return []
    }
    this.pending.delete(event.id)
    this.seen.add(event.id)
    if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value!)
    return packets.map((p) => ({ ...p, seenAt: Date.now() }))
  }

  flush(): Packet[] {
    const packets: Packet[] = []
    for (const [id, item] of this.pending) {
      if (Date.now() - item.since > 10_000) { this.pending.delete(id); continue }
      packets.push(...this.accept(item.event))
    }
    return packets
  }

  private handle(event: OpenCodeEvent): Packet[] | undefined {
    const packets: Packet[] = []
    if (event.type === "session.execution.succeeded" || event.type === "session.execution.failed" || event.type === "session.execution.interrupted") {
      const info = this.lookup(event.data.sessionID)
      if (!info) return undefined
      if (info?.parentID) packets.push({
        id: event.id, from: info.id, to: info.parentID, at: event.created,
        kind: "status", label: event.type.endsWith("succeeded") ? "执行完成" : event.type.endsWith("failed") ? "执行异常" : "执行中断",
        summary: "服务端执行状态事件；结果正文以工具返回或汇报送达记录为准。", evidence: event.type,
      })
      return packets
    }
    if (event.type === "session.inbox.enqueued") {
      const item = event.data.item
      if (item.type !== "synthetic") return []
      const metadata = item.payload.metadata
      if (metadata?.source !== "subagent" || typeof metadata.childID !== "string") return []
      const child = this.lookup(metadata.childID)
      if (!child) return undefined
      if (child?.parentID === event.data.sessionID || this.reportRoutes.has(`${child.id}:${event.data.sessionID}`)) packets.push({
        id: event.id, from: child.id, to: event.data.sessionID, at: event.created,
        kind: metadata.state === "completed" ? "report" : "failed", label: metadata.state === "completed" ? "完成汇报" : metadata.state === "interrupted" ? "中断汇报" : "失败汇报", summary: short(item.payload.text.replace(/^\s*<subagent[^>]*>/, "").replace(/<\/subagent>\s*$/, ""), 600),
        evidence: event.type, stage: "入队", inboxID: event.data.inboxID,
      })
      return packets
    }
    if (event.type === "session.tool.input.started") {
      const key = `${event.data.sessionID}:${event.data.id}`
      this.names.set(key, event.data.name)
      if (this.names.size > 4000) this.names.delete(this.names.keys().next().value!)
      if (event.data.name === "subagent") this.store(key, { name: event.data.name })
      return []
    }
    if (event.type !== "session.tool.called" && event.type !== "session.tool.progress" && event.type !== "session.tool.success" && event.type !== "session.tool.failed") return []
    const d = event.data
    const key = `${d.sessionID}:${d.id}`
    const knownName = this.names.get(key)
    if (knownName && knownName !== "subagent") {
      if (event.type === "session.tool.success" || event.type === "session.tool.failed") this.names.delete(key)
      return []
    }
    const part = this.tool(d.sessionID, d.assistantMessageID, d.id)
    const call = this.calls.get(key) ?? (knownName ? { name: knownName } : part ? { name: part.name } : undefined)
    if (!call) {
      // A progress event identifying a real child is worth retrying even if
      // this window attached after tool-input started. Ordinary tools skip it.
      const childID = "metadata" in d ? d.metadata?.sessionID : undefined
      return event.type === "session.tool.called" || (typeof childID === "string" && childID.startsWith("ses_")) ? undefined : []
    }
    if (call.name !== "subagent") return []
    if (event.type === "session.tool.called") call.input = event.data.input
    if (!call.input && part && part.state.status !== "streaming") call.input = part.state.input
    const metadata = "metadata" in d ? d.metadata : undefined
    const partMetadata = part && "metadata" in part.state ? part.state.metadata : undefined
    const target = metadata?.sessionID ?? partMetadata?.sessionID ?? call.input?.sessionID
    if (typeof target === "string" && target.startsWith("ses_")) call.target = target
    this.store(key, call)
    if (call.target && !call.sent && (metadata?.sessionID || partMetadata?.sessionID || this.lookup(call.target))) {
      const targetInfo = this.lookup(call.target)
      const relay = !!targetInfo?.parentID && targetInfo.parentID !== d.sessionID
      packets.push({
        id: `${key}:dispatch`, from: d.sessionID, to: call.target, at: event.created,
        kind: relay ? "relay" : "dispatch", label: relay ? "跨代理传递" : call.input?.sessionID ? "续派任务" : "派遣任务",
        summary: short(call.input?.description, 600) || "子代理任务", evidence: event.type,
      })
      call.sent = true
      this.reportRoutes.add(`${call.target}:${d.sessionID}`)
      if (this.reportRoutes.size > 2000) this.reportRoutes.delete(this.reportRoutes.values().next().value!)
    }
    const status = metadata?.status ?? partMetadata?.status
    if (call.target && event.type === "session.tool.success" && (status === "completed" || (status === undefined && call.input?.background !== true))) {
      packets.push({
        id: `${key}:result`, from: call.target, to: d.sessionID, at: event.created,
        kind: "result", label: "结果返回", summary: short(event.data.content.filter((c) => c.type === "text").map((c) => c.text).join("\n"), 600), evidence: event.type,
      })
    }
    if (call.target && event.type === "session.tool.failed") packets.push({
      id: `${key}:failed`, from: call.target, to: d.sessionID, at: event.created,
      kind: "failed", label: "调用失败", summary: "子代理调用返回错误；完整错误可在对应会话查看。", evidence: event.type,
    })
    if (call.target && event.type === "session.tool.success" && ["error", "failed", "interrupted"].includes(String(status))) packets.push({
      id: `${key}:failed`, from: call.target, to: d.sessionID, at: event.created,
      kind: "failed", label: "任务异常返回", summary: "调用结果包含异常或中断状态，详情见子会话。", evidence: event.type,
    })
    if (event.type === "session.tool.success" || event.type === "session.tool.failed") { this.calls.delete(key); this.names.delete(key) }
    return packets
  }

  private store(key: string, value: Call) {
    this.calls.set(key, value)
    if (this.calls.size > 500) this.calls.delete(this.calls.keys().next().value!)
  }
}
