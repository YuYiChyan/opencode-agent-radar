import type { SessionInfo } from "@opencode/client"

export type RunState = "running" | "waiting" | "done" | "error" | "stopped" | "idle"
export const stateLabels: Record<RunState, string> = {
  running: "运行中", waiting: "等待输入", done: "已完成", error: "异常", stopped: "已中断", idle: "空闲",
}

export function runState(info: SessionInfo, running: boolean, waiting = false): RunState {
  if (waiting) return "waiting"
  if (running) return "running"
  if (info.outcome === "succeeded") return "done"
  if (info.outcome === "failed") return "error"
  if (info.outcome === "interrupted") return "stopped"
  return "idle"
}

export function rootOf(id: string, sessions: readonly SessionInfo[]): string {
  const byID = new Map(sessions.map((s) => [s.id, s]))
  const seen = new Set<string>()
  while (!seen.has(id)) {
    seen.add(id)
    const parent = byID.get(id)?.parentID
    if (!parent || seen.has(parent)) break
    id = parent
  }
  return id
}

export function familyOf(root: string, sessions: readonly SessionInfo[]): SessionInfo[] {
  const included = new Set([root])
  let changed = true
  while (changed) {
    changed = false
    for (const s of sessions) {
      if (s.parentID && included.has(s.parentID) && !included.has(s.id)) {
        included.add(s.id)
        changed = true
      }
    }
  }
  return sessions.filter((s) => included.has(s.id))
}

export function elapsed(info: SessionInfo, running: boolean, now: number): string {
  const start = info.time.busy
  if (start === undefined) return "待运行"
  const end = running ? now : info.time.idle
  if (end === undefined || end < start) return "—"
  const seconds = Math.max(0, Math.floor((end - start) / 1000))
  return seconds < 60 ? `${seconds}s` : seconds < 3600
    ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    : `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`
}

export type Packet = {
  id: string
  from: string
  to: string
  at: number
  seenAt?: number
  deliveredAt?: number
  kind: "dispatch" | "relay" | "report" | "result" | "failed" | "status" | "artifact" | "file"
  label: string
  summary: string
  evidence: string
  stage?: "入队" | "已送达"
  inboxID?: string
}

export function scopedPackets(packets: readonly Packet[], ids: ReadonlySet<string>): Packet[] {
  return packets.filter((p) => ids.has(p.from) && ids.has(p.to))
}

export function short(text: unknown, limit = 240): string {
  return typeof text === "string" ? text.replace(/\s+/g, " ").trim().slice(0, limit) : ""
}

export function totalTokens(tokens: SessionInfo["tokens"] | undefined): number | undefined {
  if (!tokens) return undefined
  const values = [tokens.input, tokens.output, tokens.reasoning, tokens.cache?.read, tokens.cache?.write]
  if (values.some((value) => !Number.isFinite(value) || value! < 0)) return undefined
  return values.reduce<number>((sum, value) => sum + value!, 0)
}

export function compactTokens(tokens: number | undefined): string {
  return tokens === undefined ? "用量同步中" : `${new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(tokens)} tokens`
}
