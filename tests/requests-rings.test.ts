import assert from "node:assert/strict"
import { quotaRings } from "../src/quota-rings.ts"
import { analysisRequest } from "../src/analysis-request.ts"
import type { Packet } from "../src/state.ts"

const row = (key: string, extra: Record<string, unknown> = {}) => ({ key, label: key, value: "3 accounts", ...extra }) as any
assert.deepEqual(quotaRings([row("none", { status: "3 accounts" })]), [], "accounts 状态无 percent/amount 不得生成环")
assert.equal(quotaRings([]).length, 0, "没有 groups 不虚构来源")
const zero = quotaRings([row("zero", { group: "openai", percent: 0, value: "0%" })])
assert.equal(zero[0].percent, 0, "0% 是合法配额")
assert.equal(zero[0].color, "#ffffff")
const identity = quotaRings([row("identity", { group: "openai.team", providerID: "OpenAI", label: "Claude free text", percent: 42, value: "42%" })])
assert.equal(identity[0].key, "openai")
assert.equal(identity[0].label, "GPT")
assert.equal(identity[0].color, "#ffffff")
const amount = quotaRings([row("amount", { group: "kimi", valueType: "amount", value: "12.34000000000000000001" })])
assert.equal(amount[0].value, "12.34000000000000000001", "金额 decimal 字符串原样保留")
assert.equal(amount[0].percent, undefined)
const periods = quotaRings([
  row("5h", { group: "openai", percent: 81, value: "81%" }),
  row("week", { group: "openai", percent: 35, value: "35%" }),
  row("other-account", { group: "openai", percent: 64, value: "64%" }),
])
assert.equal(periods[0].rows.length, 3, "多账号多周期 rows 全保留")
assert.equal(periods[0].percent, 35, "最低百分比仅控制环长")
assert.equal(periods[0].value, "35%")

const session = (id: string, parentID?: string, updated = 1) => ({
  id, parentID, agent: "worker", title: "task", location: { directory: "/project" },
  time: { created: id === "ses_root" ? 0 : 1, updated },
  tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
}) as any
const list = [session("ses_root"), session("ses_child", "ses_root")]
const data = {
  session: {
    list: () => list, status: () => "idle",
    permission: { list: () => [] }, form: { list: () => [] },
  },
} as any
const packets: Packet[] = [{ id: "p1", from: "ses_child", to: "ses_root", at: 1, kind: "report", label: "完成汇报", summary: "done", evidence: "event", stage: "已送达" }]
const a = analysisRequest("server-a", "ses_root", data, packets)
list[1].time.updated = 99999
list[1].tokens = { input: 999999, output: 999999, reasoning: 999999, cache: { read: 999999, write: 999999 } }
const b = analysisRequest("server-a", "ses_root", data, packets)
assert.equal(a.signature, b.signature, "tokens/time.updated 不触发新签名")
assert.equal(a.payload, b.payload)
const file: Packet = { id: "f1", from: "ses_root", to: "ses_child", at: 2, kind: "file", label: "文件", summary: "src/a.ts", evidence: "session.tool.success" }
const withFile = analysisRequest("server-a", "ses_root", data, [...packets, file])
assert.notEqual(a.signature, withFile.signature, "新增 file 改变签名")
const artifact: Packet = { ...file, id: "a1", to: "ses_root", kind: "artifact", label: "产物" }
assert.notEqual(withFile.signature, analysisRequest("server-a", "ses_root", data, [...packets, file, artifact]).signature)
const otherServer = analysisRequest("server-b", "ses_root", data, packets)
assert.notEqual(a.rootKey, otherServer.rootKey, "不同服务器按 rootKey 隔离缓存")
assert.equal(a.signature, otherServer.signature, "相同内容保留相同内容签名")
assert.notEqual(a.rootKey, analysisRequest("server-a", "ses_other", data, packets).rootKey)
assert.notEqual(a.payload, analysisRequest("server-a", "ses_other", data, packets).payload, "root 隔离 payload")

const hugePackets = Array.from({ length: 250 }, (_, i) => ({
  id: `huge-${i}`, from: "ses_child", to: "ses_root", at: i, kind: "artifact", label: "x".repeat(100),
  summary: "x".repeat(500), evidence: "e".repeat(100),
})) as Packet[]
const huge = analysisRequest("server-a", "ses_root", data, hugePackets)
assert.ok(huge.payload.length <= 60000, `payload ${huge.payload.length} 超限`)
assert.ok(huge.signature.length > 0)
const coldData = {
  session: {
    list: () => list, status: () => "idle",
    permission: { list: () => undefined }, form: { list: () => undefined },
  },
} as any
assert.doesNotThrow(() => analysisRequest("server-a", "ses_root", coldData, packets), "冷缓存 undefined permission/form 不得抛错")

const largeFamily = [
  session("ses_big_root"),
  ...Array.from({ length: 100 }, (_, i) => session(`ses_big_${String(i).padStart(3, "0")}`, "ses_big_root", i)),
]
largeFamily[0].time.created = 0
const activeID = "ses_big_099"
const activePacket: Packet = { id: "active-new", from: activeID, to: "ses_big_root", at: 999, kind: "report", label: "完成汇报", summary: "new-active", evidence: "event", stage: "已送达" }
const largeData = {
  session: {
    list: () => largeFamily,
    status: (id: string) => id === activeID ? "running" : "idle",
    permission: { list: () => undefined }, form: { list: () => undefined },
  },
} as any
const largeRequest = analysisRequest("server-a", "ses_big_root", largeData, [activePacket])
const largePayload = JSON.parse(largeRequest.payload)
assert.ok(largePayload.nodes.length <= 80)
assert.ok(largePayload.nodes.some((n: any) => n.id === activeID), "第 100 个新活跃成员不被旧 80 截掉")
assert.ok(largePayload.packets.some((p: any) => p.id === activePacket.id), "新活跃 packet 保留")
const largeIDs = new Set(largePayload.nodes.map((n: any) => n.id))
assert.ok(largePayload.packets.every((p: any) => largeIDs.has(p.from) && largeIDs.has(p.to)), "payload 无 dangling packet")
assert.ok(largePayload.nodes.every((n: any) => !n.parentID || largeIDs.has(n.parentID)), "payload 无 dangling parent")
console.log("PASS: quota evidence/identity/decimal/zero/groups/rows; shared request stable/change/isolation/cap")
