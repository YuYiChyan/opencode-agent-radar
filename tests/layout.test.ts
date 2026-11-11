import assert from "node:assert/strict"
import { arrange, type Box, type TaskNode } from "../src/layout.ts"
import { totalTokens, compactTokens } from "../src/state.ts"

function validate(nodes: TaskNode[], width: number) {
  const started = Date.now()
  const result = arrange(nodes, "ses_root", width)
  assert.ok(Date.now() - started < 1000, "孤立/循环关系不得导致布局挂起")
  const boxes = [...result.boxes.values()]
  assert.equal(boxes.length, new Set(nodes.map((n) => n.id)).size, "每个唯一 id 恰好一框")
  assert.ok(result.width >= 1040)
  const root = result.boxes.get("ses_root")
  if (root) {
    assert.ok(Math.abs(root.x + root.w / 2 - result.width / 2) < 1e-8, "总控 x 必须精确居中")
    assert.ok(Math.abs(root.y + root.h / 2 - result.height / 2) < 1e-8, "总控 y 必须精确居中")
  }
  if (boxes.length >= 10) assert.ok(new Set(boxes.map((box) => Math.round(box.x))).size >= 4, "多任务必须横向分布，窄侧栏也不折为单列")
  for (const box of boxes) {
    assert.ok(Number.isFinite(box.x + box.y + box.w + box.h))
    assert.ok(box.x >= 0 && box.y >= 0 && box.w > 0 && box.h > 0)
    assert.ok(box.x + box.w <= result.width + 1e-8, `${box.id} 横向越界`)
    assert.ok(box.y + box.h <= result.height + 1e-8, `${box.id} 纵向越界`)
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a: Box = boxes[i], b: Box = boxes[j]
    const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
    assert.equal(overlap, false, `${a.id} 与 ${b.id} 重叠`)
  }
  return result
}

const many = [
  { id: "ses_root" },
  ...Array.from({ length: 10 }, (_, i) => ({ id: `ses_${i}`, parentID: "ses_root", tokens: i * 10000 })),
]
for (const width of [390, 1024, 1440]) validate(many, width)
const mixedUsages = [undefined, 0, 32_000, 128_000, 256_000, 1_000_000, 10_000_000]
const fifty = [
  { id: "ses_root", tokens: 500_000 },
  ...Array.from({ length: 49 }, (_, i) => ({
    id: `ses_mixed_${i}`, parentID: i % 3 ? "ses_root" : `ses_mixed_${Math.max(0, i - 1)}`,
    tokens: mixedUsages[i % mixedUsages.length],
  })),
]
validate(fifty, 1440)
validate([{ id: "ses_orphan", parentID: "ses_missing", tokens: undefined }], 390)
validate([{ id: "ses_a", parentID: "ses_b" }, { id: "ses_b", parentID: "ses_a" }], 390)
validate([{ id: "ses_duplicate" }, { id: "ses_duplicate" }], 390)
validate([{ id: "ses_root", tokens: Number.NaN }, { id: "ses_unknown" }], 390)

const usages = [0, 32_000, 128_000, 256_000, 1_000_000, 10_000_000, 100_000_000]
const areas = usages.map((tokens) => {
  const result = validate([{ id: "ses_root" }, { id: "ses_task", parentID: "ses_root", tokens }], 1440)
  const box = result.boxes.get("ses_task")!
  return box.w * box.h
})
for (let i = 1; i < areas.length; i++) assert.ok(areas[i] >= areas[i - 1], `tokens 面积必须单调不减: ${areas}`)
assert.equal(areas.at(-1), areas.at(-2), "10m 与 100m 应达到同一 log 封顶尺寸")

const tokens = { input: 100, output: 200, reasoning: 300, cache: { read: 400, write: 500 } }
assert.equal(totalTokens(tokens as any), 1500, "五类用量全部相加")
assert.equal(totalTokens(undefined), undefined)
assert.equal(totalTokens({ ...tokens, input: Number.NaN } as any), undefined)
assert.equal(totalTokens({ ...tokens, output: -1 } as any), undefined)
assert.equal(totalTokens({ ...tokens, cache: { read: 0, write: 0 } } as any), 600)
assert.equal(compactTokens(undefined), "用量同步中")
assert.equal(compactTokens(1500), "1.5K tokens")
console.log("PASS: layout 390/1024/1440; unique/nonoverlap/bounds; token growth/cap; orphan/cycle/unknown; five token fields")
