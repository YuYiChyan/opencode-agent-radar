import type { Data } from "@opencode/client/solid"
import { runState, type Packet } from "./state"
import { analysisFamily } from "./analysis-family"
import { mergePackets, publicHistory } from "./public-history"

// One canonical request shared by the always-on file watcher and visible panels.
// Clock ticks, token streaming and model display changes do not cause extra calls.
export function analysisRequest(serverID: string, rootID: string, data: Data, packets: readonly Packet[]) {
  const history = publicHistory(data).view(rootID)
  const combined = mergePackets(history.packets, packets)
  const family = analysisFamily(rootID, data, combined)
  const ids = new Set(family.map((info) => info.id))
  const traffic = combined.filter((p) => ids.has(p.from) && ids.has(p.to))
  const snapshot = {
    rootID,
    nodes: family.map((info) => ({ id: info.id, parentID: info.parentID, name: info.agent ?? "agent", title: (info.title ?? "").slice(0, 200), state: runState(info, data.session.status(info.id) === "running", (data.session.permission.list(info.id)?.length ?? 0) > 0 || (data.session.form.list(info.id, info.location)?.length ?? 0) > 0), summary: [history.summaries[info.id] ?? "", traffic.filter((p) => p.from === info.id && (p.kind === "result" || (p.kind === "report" && p.stage === "已送达"))).at(-1)?.summary ?? ""].filter(Boolean).join("\n").slice(0, 700) })),
    packets: traffic.slice(-120).map(({ id, from, to, kind, label, summary, evidence, stage }) => ({ id, from, to, kind, label, evidence, stage, summary: summary.slice(0, kind === "file" || kind === "artifact" ? 280 : 120) })),
  }
  let payload = JSON.stringify(snapshot)
  while (payload.length > 60000 && snapshot.packets.length) { snapshot.packets.shift(); payload = JSON.stringify(snapshot) }
  while (payload.length > 60000 && snapshot.nodes.length > 1) { snapshot.nodes.pop(); const included = new Set(snapshot.nodes.map((n) => n.id)); snapshot.packets = snapshot.packets.filter((p) => included.has(p.from) && included.has(p.to)); payload = JSON.stringify(snapshot) }
  let hash = 2166136261
  for (let i = 0; i < payload.length; i++) hash = Math.imul(hash ^ payload.charCodeAt(i), 16777619)
  return { rootKey: `${serverID}\n${rootID}`, signature: (hash >>> 0).toString(16), payload }
}
