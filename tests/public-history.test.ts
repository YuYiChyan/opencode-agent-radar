import assert from "node:assert/strict"
import { projectHistory, mergePackets, publicHistory, readHistoryBounded } from "../src/public-history.ts"
import type { Packet } from "../src/state.ts"

const info = (id: string, parentID?: string) => ({ id, parentID, time: { created: 1, busy: 1 } }) as any
const family = [info("ses_root"), info("ses_child", "ses_root"), info("ses_other")]
const baseAssistant = {
  id: "msg", type: "assistant", time: { created: 10, completed: 20 }, finish: "stop", content: [],
} as any
const textMessage = { ...baseAssistant, content: [
  { type: "text", text: "公开完成文本" },
  { type: "reasoning", text: "私有推理不得入投影" },
], native: { hidden: "不得入投影" } }
const privateMessages = [
  textMessage,
  { id: "u", type: "user", text: "用户输入不得入投影" },
  { id: "s", type: "synthetic", text: "synthetic 不得入投影" },
] as any
const projected = projectHistory(info("ses_root"), privateMessages, family)
assert.deepEqual(projected.outputs, [{ id: "ses_root", at: 20, text: "公开完成文本" }])
assert.ok(!JSON.stringify(projected).includes("私有推理"))
assert.ok(!JSON.stringify(projected).includes("用户输入"))
assert.ok(!JSON.stringify(projected).includes("synthetic"))
assert.ok(!JSON.stringify(projected).includes("hidden"))
assert.deepEqual(projectHistory(info("ses_missing"), [textMessage], family).outputs, [], "同树外会话不投影")
const unfinished = { ...baseAssistant, finish: "tool-calls", time: { created: 10 }, content: [{ type: "text", text: "未完成" }] }
assert.equal(projectHistory(info("ses_root"), [unfinished], family).outputs.length, 0)
const early = { ...textMessage, time: { created: 0, completed: 2 } }
assert.equal(projectHistory(info("ses_root"), [early], family).outputs.length, 0)

const tool = (id: string, target: string, status: unknown, background?: boolean) => ({
  ...baseAssistant, content: [{ type: "tool", id, name: "subagent", time: { created: 10, completed: 20 }, state: {
    status: "completed", input: { description: `任务-${id}`, sessionID: target, background },
    metadata: { sessionID: target, status }, content: [{ type: "text", text: `结果-${id}` }],
  } }],
})
const ack = projectHistory(info("ses_root"), [tool("ack", "ses_child", "running", true)], family)
assert.equal(ack.packets.length, 1)
assert.equal(ack.packets[0].kind, "dispatch")
assert.equal(ack.packets[0].seenAt, 0)
assert.ok(!ack.packets.some((p) => p.kind === "result"), "后台 ack 不伪造 result")
const done = projectHistory(info("ses_root"), [tool("done", "ses_child", "completed", true)], family)
assert.deepEqual(done.packets.map((p) => [p.kind, p.from, p.to, p.seenAt]), [
 ["dispatch", "ses_root", "ses_child", 0], ["result", "ses_child", "ses_root", 0],
])
assert.equal(done.tasks[0].id, "ses_child")
const sameFamilyRelay = projectHistory(info("ses_child"), [tool("relay", "ses_root", "completed")], family)
assert.equal(sameFamilyRelay.packets[0].kind, "relay")
assert.equal(projectHistory(info("ses_root"), [tool("self", "ses_root", "completed")], family).packets.length, 0)
assert.equal(projectHistory(info("ses_root"), [tool("external", "ses_external", "completed")], family).packets.length, 0)
const nonTool = { ...baseAssistant, content: [{ type: "tool", id: "shell", name: "shell", time: { created: 10, completed: 20 }, state: { status: "completed", input: {}, metadata: { sessionID: "ses_child" }, content: [{ type: "text", text: "not subagent" }] } }] }
assert.equal(projectHistory(info("ses_root"), [nonTool], family).packets.length, 0)

const historyPacket = done.packets[0]
const livePacket: Packet = { ...historyPacket, seenAt: 999, summary: "live wins" }
const merged = mergePackets([historyPacket], [livePacket])
assert.equal(merged.length, 1)
assert.equal(merged[0].summary, "live wins")
assert.equal(merged[0].seenAt, 999, "history/live 同 ID live 优先")

const dataA = {} as any, dataB = {} as any
assert.equal(publicHistory(dataA), publicHistory(dataA), "同 data 共享 store")
assert.notEqual(publicHistory(dataA), publicHistory(dataB), "不同 data 隔离")
const store = publicHistory(dataA)
const many = Array.from({ length: 40 }, (_, i) => info(`ses_h_${String(i).padStart(2, "0")}`, "ses_h_root"))
many.unshift(info("ses_h_root"))
let active = 0, maxActive = 0, calls = 0
const loads: Promise<unknown>[] = []
const hydrated = await store.hydrate("ses_h_root", many, async () => {
  calls++; active++; maxActive = Math.max(maxActive, active)
  const pending = new Promise((resolve) => setImmediate(() => { active--; resolve([]) }))
  loads.push(pending)
  return pending as any
}, new AbortController().signal)
await hydrated
assert.equal(calls, 32, "每次 hydrate 最多 32 session")
assert.ok(maxActive <= 2, `并发必须 <=2，实际 ${maxActive}`)
assert.deepEqual(store.view("ses_h_root").loaded.length, 32)
await store.hydrate("ses_other_root", many, async () => [], new AbortController().signal)
assert.notEqual(store.view("ses_h_root"), store.view("ses_other_root"), "同 data 按 root 隔离")
const abort = new AbortController(); abort.abort()
let abortedLoads = 0
await store.hydrate("ses_abort_root", many, async () => { abortedLoads++; return [] }, abort.signal)
assert.equal(abortedLoads, 0)
assert.deepEqual(store.view("ses_abort_root").loaded, [], "abort 安全不发布部分结果")
// 独立 bounded read：即使底层 run 忽略 signal，也必须独立 timeout/reject。
let lateResolve!: (value: string) => void
const boundedStart = Date.now()
const bounded = readHistoryBounded(() => new Promise<string>((resolve) => { lateResolve = resolve }), new AbortController().signal, 10)
await assert.rejects(bounded, /超时/)
lateResolve("迟到结果")
await new Promise((resolve) => setImmediate(resolve))
assert.ok(Date.now() - boundedStart < 1000)
let result: string | undefined
await assert.rejects(readHistoryBounded(() => new Promise<string>(() => {}), new AbortController().signal, 5).then((v) => { result = v }), /超时/)
assert.equal(result, undefined)
assert.equal(await readHistoryBounded(async () => "accepted", new AbortController().signal, 50), "accepted", "正常立即 resolve 不应 timeout")

// abort 释放 busy；随后新 hydrate 成功，旧 late load 不得覆盖新结果。
const raceData = {} as any, raceStore = publicHistory(raceData)
const root = info("ses_race_root"), child = info("ses_race_child", "ses_race_root")
const raceFamily = [root, child]
const firstController = new AbortController()
let releaseOld: ((messages: any[]) => void) | undefined
let oldStarted!: () => void
const oldRunning = new Promise<void>((resolve) => { oldStarted = resolve })
const first = raceStore.hydrate("ses_race_root", raceFamily, async (id) => {
  if (id === root.id) return new Promise<any[]>((resolve) => { releaseOld = resolve; oldStarted() })
  return []
}, firstController.signal)
await oldRunning
firstController.abort()
await first
releaseOld?.([tool("old", "ses_race_child", "completed")])
await new Promise((resolve) => setImmediate(resolve))
await raceStore.hydrate("ses_race_root", raceFamily, async (id) => id === root.id ? [tool("new", "ses_race_child", "completed")] : [], new AbortController().signal)
const raced = raceStore.view("ses_race_root").packets
assert.ok(raced.some((p) => p.id.includes(":new:dispatch")), "abort 后可重新 hydrate")
assert.ok(!raced.some((p) => p.id.includes(":old:dispatch")), "旧 late load 不覆盖新结果")

// membership revision：新增成员立即使旧 root 历史失效并重投影其派遣。
const revisionData = {} as any, revisionStore = publicHistory(revisionData)
const revisionRoot = info("ses_revision_root"), revisionChild = info("ses_revision_child", "ses_revision_root")
await revisionStore.hydrate("ses_revision_root", [revisionRoot], async () => [tool("member", "ses_revision_child", "completed")], new AbortController().signal)
assert.equal(revisionStore.view("ses_revision_root").packets.length, 0, "成员尚未入树时过滤历史派遣")
await revisionStore.hydrate("ses_revision_root", [revisionRoot, revisionChild], async () => [tool("member", "ses_revision_child", "completed")], new AbortController().signal)
assert.ok(revisionStore.view("ses_revision_root").packets.some((p) => p.to === "ses_revision_child"), "新增成员无需等待 60s")
console.log("PASS: public projection/completed text/tool ack-result/same-family/live precedence; hydrate concurrency/batch/abort/root isolation; bounded timeout/late safety/membership revision")
