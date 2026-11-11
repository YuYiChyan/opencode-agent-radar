import assert from "node:assert/strict"
import { DECK_WINDOW, deckWindow, usageScale, focusedGraph, arrangeFocus, connection, fitGraph, type GraphNode, type Relation } from "../src/deck-graph.ts"
import type { Packet } from "../src/state.ts"

assert.equal(DECK_WINDOW, 7)
assert.deepEqual(deckWindow(["a", "b", "c"], -1), ["c", "a", "b"], "小堆反向首尾循环")
assert.deepEqual(deckWindow(["a", "b", "c"], 3), ["a", "b", "c"], "小堆正向循环")
const ten = Array.from({ length: 10 }, (_, i) => i)
assert.deepEqual(deckWindow(ten, -1), [9, 0, 1, 2, 3, 4, 5])
assert.deepEqual(deckWindow(ten, 9), [9, 0, 1, 2, 3, 4, 5])
assert.ok(deckWindow(ten, 25).length <= DECK_WINDOW)
assert.equal(new Set(deckWindow(ten, 25)).size, DECK_WINDOW, "循环窗口无重复")
assert.deepEqual(deckWindow([], 4), [])
assert.deepEqual(focusedGraph([], undefined, []), { ids: [], edges: [] })
const nodes: GraphNode[] = [
  { id: "ses_root" }, { id: "ses_parent", parentID: "ses_root" },
  { id: "ses_focus", parentID: "ses_parent" }, { id: "ses_sibling", parentID: "ses_parent" },
  { id: "ses_child", parentID: "ses_focus" }, { id: "ses_unrelated" },
]
const p = (id: string, from: string, to: string, kind: Packet["kind"]): Packet => ({ id, from, to, at: 1, kind, label: kind, summary: `${kind}-${id}`, evidence: "fixture" })
const inferred: Relation[] = [{ from: "ses_root", to: "ses_focus", label: "AI 推断", inferred: true }]
const graph = focusedGraph(nodes, "ses_focus", [
  p("self-artifact", "ses_focus", "ses_focus", "artifact"),
  p("artifact", "ses_child", "ses_focus", "artifact"),
  p("unknown", "ses_missing", "ses_focus", "file"),
  p("file", "ses_child", "ses_focus", "file"),
  p("task", "ses_sibling", "ses_focus", "dispatch"),
], inferred)
assert.ok(graph.ids.includes("ses_parent") && graph.ids.includes("ses_root"), "嵌套祖先保留")
assert.ok(!graph.ids.includes("ses_unrelated"), "不纳入全树")
assert.ok(!graph.ids.includes("ses_missing"), "未知 session 过滤")
assert.ok(!graph.edges.some((e) => e.from === e.to || e.kind === "artifact"), "self/artifact 过滤")
assert.ok(graph.edges.some((e) => e.kind === "file" && e.inferred === false))
assert.ok(graph.edges.some((e) => e.kind === "observed" && e.inferred === false))
assert.ok(graph.edges.some((e) => e.kind === "inferred" && e.inferred === true), "AI 推断保留虚线语义")
assert.ok(graph.edges.some((e) => e.kind === "task" && e.inferred === false))
assert.deepEqual(focusedGraph(nodes, "ses_unknown", []), { ids: [], edges: [] })
const hopNodes: GraphNode[] = [{ id: "ses_root" }, { id: "ses_A" }, { id: "ses_B" }, { id: "ses_C" }, { id: "ses_whole_tree" }]
const hops = focusedGraph(hopNodes, "ses_A", [
 p("ab", "ses_A", "ses_B", "dispatch"), p("bc", "ses_B", "ses_C", "file"),
])
assert.ok(hops.ids.includes("ses_C"), "A-B-C 二跳协作可见")
assert.ok(!hops.ids.includes("ses_whole_tree"), "不经 root 扩全树")
const labelled = focusedGraph(nodes, "ses_focus", [
 { ...p("label1", "ses_sibling", "ses_focus", "dispatch"), label: "派遣甲" },
 { ...p("label2", "ses_sibling", "ses_focus", "dispatch"), label: "派遣乙" },
]).edges.find((e) => e.from === "ses_sibling")!
assert.equal(labelled.labels?.length, 2, "多标签均保留")
assert.ok(labelled.label.includes("派遣甲") && labelled.label.includes("派遣乙"))
const cycle: GraphNode[] = [{ id: "ses_a", parentID: "ses_b" }, { id: "ses_b", parentID: "ses_a" }]
const started = Date.now()
assert.deepEqual(focusedGraph(cycle, "ses_a", []).ids.sort(), ["ses_a", "ses_b"])
assert.deepEqual(arrangeFocus(cycle, "ses_a", []).boxes.size, 2)
assert.ok(Date.now() - started < 1000, "cycle 必须终止")

const scales = [undefined, Number.NaN, -100, 0, 32_000, 1_000_000, 10_000_000, 100_000_000].map(usageScale)
for (const scale of scales) assert.ok(Number.isFinite(scale) && scale >= 1 && scale <= 1.126)
for (let i = 3; i < scales.length; i++) assert.ok(scales[i] >= scales[i - 1])
assert.equal(usageScale(-100), 1)
assert.equal(usageScale(Number.NaN), 1)
assert.equal(usageScale(10_000_000), usageScale(100_000_000), "usageScale 有封顶")

const many: GraphNode[] = [{ id: "ses_focus", tokens: 100_000_000 }, ...Array.from({ length: 40 }, (_, i) => ({ id: `ses_${i}` }))]
const edges = many.slice(1).map((n) => ({ from: "ses_focus", to: n.id, label: "task", inferred: false, kind: "task" as const }))
const layout = arrangeFocus(many, "ses_focus", edges)
assert.equal(layout.boxes.size, many.length)
const boxes = [...layout.boxes.values()]
for (let i = 0; i < boxes.length; i++) {
 const a = boxes[i]
 assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.w <= layout.width && a.y + a.h <= layout.height)
 for (let j = i + 1; j < boxes.length; j++) {
  const b = boxes[j]
  assert.equal(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y, false, `${a.id}/${b.id} 不重叠`)
 }
}
const focus = layout.boxes.get("ses_focus")!
assert.ok(focus.w < 260 && focus.h < 145, "中心选中尺寸有限")
assert.ok(Math.abs(focus.x + focus.w / 2 - layout.width / 2) < 1e-8)
assert.ok(Math.abs(focus.y + focus.h / 2 - layout.height / 2) < 1e-8)
assert.match(connection(focus, boxes[0]), /^M .* C /)

// 窄侧栏关系图：438 双列、紧凑卡片边界与不重叠，不扩展为整棵任务树。
const compactNodes: GraphNode[] = [
  { id: "ses_root" }, { id: "ses_parent", parentID: "ses_root" },
  { id: "ses_compact", parentID: "ses_parent" }, { id: "ses_peer", parentID: "ses_parent" },
  { id: "ses_unrelated_compact" },
]
const compactGraph = focusedGraph(compactNodes, "ses_compact", [])
assert.ok(!compactGraph.ids.includes("ses_unrelated_compact"), "compact 图不返回整树")
const compactLayoutNodes = compactGraph.ids.map((id) => compactNodes.find((n) => n.id === id)!)
const compactLayout = arrangeFocus(compactLayoutNodes, "ses_compact", compactGraph.edges, true)
assert.equal(compactLayout.width, 438, "compact 两列宽 438")
assert.equal(compactLayout.boxes.size, compactGraph.ids.length)
const compactBoxes = [...compactLayout.boxes.values()]
for (let i = 0; i < compactBoxes.length; i++) {
 const a = compactBoxes[i]
 assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.w <= compactLayout.width && a.y + a.h <= compactLayout.height)
 assert.equal(a.w, a.id === "ses_compact" ? 180 : 170)
 assert.equal(a.h, a.id === "ses_compact" ? 66 : 58)
 for (let j = i + 1; j < compactBoxes.length; j++) {
  const b = compactBoxes[j]
  assert.equal(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y, false, `compact ${a.id}/${b.id} 不重叠`)
 }
}
const compactRight = arrangeFocus([
 { id: "ses_compact" }, { id: "ses_output" },
], "ses_compact", [{ from: "ses_compact", to: "ses_output", label: "task", inferred: false, kind: "task" }], true)
assert.equal(compactRight.width, 658)
assert.equal(compactRight.boxes.get("ses_output")!.w, 170)
// 纯参数证明窗口轮转：page 从 0 到 length-DECK_WINDOW，每一索引均可落入某窗口。
for (let length = 8; length <= 60; length++) for (let index = 0; index < length; index++) {
 const page = Math.min(index, Math.max(0, length - DECK_WINDOW))
 assert.ok(index >= page && index < page + DECK_WINDOW)
}
// fitGraph 必须覆盖所有可见框，包括手动偏移后的位置，且完整居中于 viewport。
function verifyFit(input: readonly { id: string; x: number; y: number; w: number; h: number }[], width: number, height: number) {
 const fit = fitGraph(input, width, height)
 assert.ok(Number.isFinite(fit.scale + fit.x + fit.y) && fit.scale > 0 && fit.scale <= 1)
 if (!input.length || width <= 0 || height <= 0) return fit
 for (const b of input) {
  const x = b.x * fit.scale + fit.x, y = b.y * fit.scale + fit.y
  assert.ok(x >= -1e-8 && y >= -1e-8, `${b.id} 左/上越界`)
  assert.ok(x + b.w * fit.scale <= width + 1e-8 && y + b.h * fit.scale <= height + 1e-8, `${b.id} 右/下越界`)
 }
 const left = Math.min(...input.map((b) => b.x * fit.scale + fit.x))
 const right = Math.max(...input.map((b) => (b.x + b.w) * fit.scale + fit.x))
 const top = Math.min(...input.map((b) => b.y * fit.scale + fit.y))
 const bottom = Math.max(...input.map((b) => (b.y + b.h) * fit.scale + fit.y))
 assert.ok(Math.abs((left + right) / 2 - width / 2) < 1e-8, "bbox 水平居中")
 assert.ok(Math.abs((top + bottom) / 2 - height / 2) < 1e-8, "bbox 垂直居中")
 return fit
}
assert.deepEqual(fitGraph([], 300, 200), { scale: 1, x: 0, y: 0 })
assert.deepEqual(fitGraph(boxes, 0, 200), { scale: 1, x: 0, y: 0 })
assert.deepEqual(fitGraph(boxes, 300, 0), { scale: 1, x: 0, y: 0 })
verifyFit([{ id: "single", x: 20, y: 30, w: 100, h: 80 }], 320, 180)
for (const [width, height] of [[180, 90], [280, 140], [390, 200], [1024, 768]]) verifyFit(boxes, width, height)
const moved = boxes.map((b, i) => i === 7 ? { ...b, x: b.x + 1700, y: b.y - 950 } : b)
verifyFit(moved, 390, 180)
verifyFit(moved, 1440, 900)
console.log("PASS: deck focus/ancestry/cycle/filter/source kinds; bounded token scale; 40-neighbor nonoverlap; DECK_WINDOW=7 reachability; fitGraph complete/centered/moved/zero")
