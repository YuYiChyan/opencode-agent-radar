import type { Packet } from "./state"
import type { Box } from "./layout"

export type GraphNode = { id: string; parentID?: string; tokens?: number }
export type Relation = { from: string; to: string; label: string; labels?: string[]; inferred: boolean; kind?: "task" | "file" | "observed" | "inferred" }
export const DECK_WINDOW = 7

export function deckWindow<T>(items: readonly T[], offset: number, count = DECK_WINDOW): T[] {
  if (!items.length) return []
  const start = ((Math.trunc(offset) % items.length) + items.length) % items.length
  return Array.from({ length: Math.min(items.length, count) }, (_, i) => items[(start + i) % items.length]!)
}

export function usageScale(tokens?: number) {
  const count = Number.isFinite(tokens) ? Math.max(0, tokens!) : 0
  return 1 + Math.min(7, Math.log2(1 + count / 16000)) * .018
}

// The graph is opt-in and local to the extracted card, never the entire task tree.
export function focusedGraph(nodes: readonly GraphNode[], selected: string | undefined, packets: readonly Packet[], inferred: readonly Relation[] = []) {
  const byID = new Map(nodes.map((node) => [node.id, node]))
  if (!selected || !byID.has(selected)) return { ids: [] as string[], edges: [] as Relation[] }
  const all: Relation[] = []
  for (const node of nodes) if (node.parentID && byID.has(node.parentID)) all.push({ from: node.parentID, to: node.id, label: "任务派遣", inferred: false, kind: "task" })
  for (const p of packets) {
    if (p.from === p.to || !byID.has(p.from) || !byID.has(p.to) || p.kind === "status" || p.kind === "artifact") continue
    all.push({ from: p.from, to: p.to, label: p.kind === "file" ? p.summary : p.label, inferred: false, kind: p.kind === "file" ? "file" : "observed" })
  }
  for (const edge of inferred) if (byID.has(edge.from) && byID.has(edge.to) && edge.from !== edge.to) all.push({ ...edge, kind: edge.inferred ? "inferred" : "observed" })
  const ids = new Set([selected])
  let relevant = all.filter((e) => e.from === selected || e.to === selected)
  for (const edge of relevant) { ids.add(edge.from); ids.add(edge.to) }
  // Keep the actual ancestry visible even when the selected worker is nested.
  let current = byID.get(selected)
  const visited = new Set([selected])
  while (current?.parentID && byID.has(current.parentID) && !visited.has(current.parentID)) {
    relevant.push({ from: current.parentID, to: current.id, label: "任务派遣", inferred: false, kind: "task" })
    ids.add(current.parentID); visited.add(current.parentID); current = byID.get(current.parentID)
  }
  // Expand one further collaboration hop, never fan out through the controller's
  // dispatch tree. Then retain the induced edges among the visible neighbours.
  const direct = new Set(ids)
  for (const edge of all) {
    if (ids.size >= 32) break
    if (edge.kind === "task" || visited.has(edge.from) || visited.has(edge.to)) continue
    if (direct.has(edge.from) || direct.has(edge.to)) { ids.add(edge.from); ids.add(edge.to) }
  }
  relevant = [...relevant, ...all.filter((edge) => ids.has(edge.from) && ids.has(edge.to))]
  const unique = new Map<string, Relation>()
  for (const edge of relevant) {
    const key = `${edge.from}\n${edge.to}\n${edge.kind}\n${edge.inferred}`, prior = unique.get(key)
    const labels = [...new Set([...(prior?.labels ?? []), edge.label])]
    unique.set(key, { ...edge, labels, label: labels.join(" · ") })
  }
  return { ids: [...ids], edges: [...unique.values()] }
}

export function arrangeFocus(nodes: readonly GraphNode[], selected: string | undefined, edges: readonly Relation[], compact = false) {
  const boxes = new Map<string, Box>()
  const focus = nodes.find((n) => n.id === selected)
  if (!focus) return { boxes, width: 780, height: 320 }
  const outgoing = new Set(edges.filter((e) => e.from === selected).map((e) => e.to))
  const ancestors = new Set<string>()
  let node: GraphNode | undefined = focus
  while (node?.parentID && !ancestors.has(node.parentID)) { ancestors.add(node.parentID); node = nodes.find((n) => n.id === node!.parentID) }
  const left = nodes.filter((n) => n.id !== selected && (ancestors.has(n.id) || !outgoing.has(n.id)))
  const right = nodes.filter((n) => n.id !== selected && !left.includes(n))
  if (compact) {
    const height = Math.max(150, Math.max(left.length, right.length) * 82 + 24)
    const put = (list: readonly GraphNode[], x: number) => list.forEach((n, i) => boxes.set(n.id, { id: n.id, x, y: (height - list.length * 82) / 2 + i * 82 + 12, w: 170, h: 58 }))
    put(left, 18); put(right, 470)
    boxes.set(focus.id, { id: focus.id, x: left.length ? 240 : 30, y: height / 2 - 33, w: 180, h: 66 })
    return { boxes, width: right.length ? 658 : left.length ? 438 : 240, height }
  }
  const height = Math.max(320, Math.max(left.length, right.length) * 108 + 40)
  const put = (list: readonly GraphNode[], x: number) => list.forEach((n, i) => boxes.set(n.id, { id: n.id, x, y: (height - list.length * 108) / 2 + i * 108 + 10, w: 194, h: 88 }))
  put(left, 18); put(right, 568)
  const size = usageScale(focus.tokens)
  boxes.set(focus.id, { id: focus.id, x: 390 - 112 * size, y: height / 2 - 62 * size, w: 224 * size, h: 124 * size })
  return { boxes, width: 780, height }
}

export function connection(from: Box, to: Box) {
  const forward = to.x + to.w / 2 > from.x + from.w / 2
  const x1 = forward ? from.x + from.w : from.x, x2 = forward ? to.x : to.x + to.w
  const y1 = from.y + from.h / 2, y2 = to.y + to.h / 2
  const mid = (x1 + x2) / 2
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`
}

// Fit the complete visible neighbourhood, including manually positioned nodes.
// There is deliberately no minimum scale that could force part of it offscreen.
export function fitGraph(boxes: readonly Box[], width: number, height: number) {
  if (!boxes.length || width <= 0 || height <= 0) return { scale: 1, x: 0, y: 0 }
  const left = Math.min(...boxes.map((b) => b.x)), top = Math.min(...boxes.map((b) => b.y))
  const right = Math.max(...boxes.map((b) => b.x + b.w)), bottom = Math.max(...boxes.map((b) => b.y + b.h))
  const padding = Math.min(12, width / 10, height / 10)
  const scale = Math.min(1, (width - padding * 2) / Math.max(1, right - left), (height - padding * 2) / Math.max(1, bottom - top))
  return { scale, x: (width - (right - left) * scale) / 2 - left * scale, y: (height - (bottom - top) * scale) / 2 - top * scale }
}
