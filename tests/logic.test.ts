import assert from "node:assert/strict"
import { runState, rootOf, familyOf, elapsed, scopedPackets, type Packet } from "../src/state.ts"
import { Traffic } from "../src/traffic.ts"

const info = (id: string, parentID?: string, extra: Record<string, unknown> = {}) => ({
  id, parentID, time: {}, ...extra,
}) as any
const sessions = [
  info("ses_root"), info("ses_child", "ses_root"), info("ses_grand", "ses_child"),
  info("ses_sibling", "ses_root"), info("ses_other"), info("ses_orphan", "ses_other"),
]
assert.equal(rootOf("ses_grand", sessions), "ses_root")
assert.deepEqual(familyOf("ses_root", sessions).map((s) => s.id), ["ses_root", "ses_child", "ses_grand", "ses_sibling"])
assert.equal(rootOf("ses_missing", sessions), "ses_missing")
const cycle = [info("ses_a", "ses_b"), info("ses_b", "ses_a")]
assert.ok(["ses_a", "ses_b"].includes(rootOf("ses_a", cycle)), "循环父链必须终止")

assert.equal(runState(info("ses_x"), false), "idle")
assert.notEqual(runState(info("ses_x"), false), "done")
assert.equal(runState(info("ses_x", undefined, { outcome: "succeeded" }), false), "done")
assert.equal(runState(info("ses_x", undefined, { outcome: "succeeded" }), true), "running")
assert.equal(runState(info("ses_x", undefined, { outcome: "failed" }), true), "running")
assert.equal(runState(info("ses_x", undefined, { outcome: "succeeded" }), true, true), "waiting")
const completed = info("ses_x", undefined, { time: { busy: 1_000, idle: 6_000 } })
assert.equal(elapsed(completed, false, 20_000), "5s")
assert.equal(elapsed(completed, true, 9_000), "8s")
assert.equal(elapsed(info("ses_x"), false, 9_000), "待运行")
const packet = (id: string, from: string, to: string): Packet => ({ id, from, to, at: 0, kind: "status", label: "", summary: "", evidence: "" })
assert.deepEqual(scopedPackets([packet("in", "ses_root", "ses_child"), packet("out", "ses_root", "ses_other")], new Set(["ses_root", "ses_child"])).map((p) => p.id), ["in"])

const toolPart = (name = "subagent") => ({ name, state: { status: "running", input: {}, metadata: {} } }) as any
let n = 0
const event = (type: string, sessionID: string, data: Record<string, unknown> = {}) => ({
  id: `evt_${++n}`, created: 100 + n, type, data: {
    sessionID, assistantMessageID: "msg", id: "call", ...data,
  },
}) as any
const lookup = (id: string) => sessions.find((s) => s.id === id)
const t = new Traffic(lookup, () => toolPart())

assert.equal(t.accept(event("session.tool.input.started", "ses_root", { name: "subagent" })).length, 0)
assert.deepEqual(t.accept(event("session.tool.called", "ses_root", { input: { description: "bg", background: true } })).map((p) => p.kind), [])
const bgProgress = event("session.tool.progress", "ses_root", { metadata: { sessionID: "ses_child", status: "running" } })
assert.deepEqual(t.accept(bgProgress).map((p) => [p.kind, p.from, p.to]), [["dispatch", "ses_root", "ses_child"]])
assert.deepEqual(t.accept(event("session.tool.success", "ses_root", {
  content: [{ type: "text", text: "accepted" }], metadata: { sessionID: "ses_child", status: "running" },
})).map((p) => p.kind), [])
assert.deepEqual(t.accept(bgProgress), [], "相同事件 ID 必须去重")

const report = event("session.inbox.enqueued", "ses_root", {
  inboxID: "inbox", item: { type: "synthetic", payload: {
    text: '<subagent sessionID="ses_child" state="completed" description="测试任务">正文</subagent>',
    metadata: { source: "subagent", childID: "ses_child", agent: "worker-kimi", state: "completed" },
  } },
})
const reportPackets = t.accept(report)
assert.deepEqual(reportPackets.map((p) => [p.kind, p.from, p.to, p.stage]), [["report", "ses_child", "ses_root", "入队"]])
assert.equal(reportPackets[0].summary, "正文")
assert.deepEqual(t.accept(event("session.inbox.enqueued", "ses_other", {
  inboxID: "inbox", item: { type: "synthetic", payload: { text: '<subagent sessionID="ses_child" state="completed">越界</subagent>' } },
})), [])
assert.deepEqual(t.accept(event("session.text.delta", "ses_child", { ordinal: 0, delta: '<subagent sessionID="ses_child" state="completed">' })), [])

const fg = new Traffic(lookup, () => toolPart())
fg.accept(event("session.tool.input.started", "ses_root", { name: "subagent" }))
fg.accept(event("session.tool.called", "ses_root", { input: { description: "fg" } }))
fg.accept(event("session.tool.progress", "ses_root", { metadata: { sessionID: "ses_child", status: "running" } }))
assert.deepEqual(fg.accept(event("session.tool.success", "ses_root", {
  content: [{ type: "text", text: "actual result" }], metadata: { sessionID: "ses_child", status: "completed" },
})).map((p) => [p.kind, p.summary]), [["result", "actual result"]])

// 子代理调用自己的子代理是普通 dispatch；兄弟之间续派才是 relay。
const nested = new Traffic(lookup, () => toolPart())
nested.accept(event("session.tool.input.started", "ses_child", { name: "subagent" }))
assert.deepEqual(nested.accept(event("session.tool.called", "ses_child", { input: { sessionID: "ses_grand", description: "nested" } })).map((p) => p.kind), ["dispatch"])
assert.deepEqual(nested.accept(event("session.tool.progress", "ses_child", { metadata: { sessionID: "ses_grand", status: "running" } })), [])
const relay = new Traffic(lookup, () => toolPart())
relay.accept(event("session.tool.input.started", "ses_child", { name: "subagent" }))
const relayCalled = event("session.tool.called", "ses_child", { input: { sessionID: "ses_sibling", description: "relay" } })
assert.deepEqual(relay.accept(relayCalled).map((p) => [p.kind, p.from, p.to]), [["relay", "ses_child", "ses_sibling"]])
assert.deepEqual(relay.accept(event("session.tool.progress", "ses_child", { metadata: { sessionID: "ses_sibling", status: "running" } })), [], "called 已派遣后 progress 不重复")
const siblingReport = relay.accept(event("session.inbox.enqueued", "ses_child", {
  inboxID: "sibling-inbox", item: { type: "synthetic", payload: {
    text: '<subagent sessionID="ses_sibling" state="completed">兄弟结果</subagent>',
    metadata: { source: "subagent", childID: "ses_sibling", agent: "worker-kimi", state: "completed" },
  } },
}))
assert.deepEqual(siblingReport.map((p) => [p.kind, p.from, p.to]), [["report", "ses_sibling", "ses_child"]])
const unobserved = new Traffic(lookup, () => toolPart())
assert.deepEqual(unobserved.accept(event("session.inbox.enqueued", "ses_child", {
  inboxID: "unobserved-inbox", item: { type: "synthetic", payload: {
    text: '<subagent sessionID="ses_sibling" state="completed">未观察跨代理</subagent>',
    metadata: { source: "subagent", childID: "ses_sibling", state: "completed" },
  } },
})), [])
const unrelated = new Traffic(lookup, () => toolPart())
unrelated.accept(event("session.tool.input.started", "ses_other", { name: "subagent" }))
const crossTree = unrelated.accept(event("session.tool.called", "ses_other", { input: { sessionID: "ses_child" } }))
assert.deepEqual(crossTree.map((p) => p.kind), ["relay"])
assert.deepEqual(scopedPackets(crossTree, new Set(["ses_root", "ses_child"])), [])
assert.deepEqual(unrelated.accept(event("session.tool.progress", "ses_other", { metadata: { sessionID: "ses_child", status: "running" } })), [])
const status = t.accept(event("session.execution.succeeded", "ses_child"))
assert.deepEqual(status.map((p) => [p.kind, p.from, p.to]), [["status", "ses_child", "ses_root"]])
assert.equal(status[0].summary.includes("结果正文"), true)

// 真实乱序：started 已知名称，缓存晚到时 called 保留 input，随后 progress 补发派遣。
let delayedPart: any
const delayed = new Traffic(lookup, () => delayedPart)
delayed.accept(event("session.tool.input.started", "ses_root", { id: "late-call", name: "subagent" }))
const lateCalled = event("session.tool.called", "ses_root", { id: "late-call", input: { description: "late", background: true } })
assert.deepEqual(delayed.accept(lateCalled), [])
assert.deepEqual(delayed.flush(), [], "缓存未就绪时保留 pending，不画边")
delayedPart = toolPart()
assert.deepEqual(delayed.flush(), [], "called 尚无 sessionID 时不画派遣")
const lateProgressWithCache = event("session.tool.progress", "ses_root", { id: "late-call", metadata: { sessionID: "ses_child", status: "running" } })
assert.deepEqual(delayed.accept(lateProgressWithCache).map((p) => [p.kind, p.summary]), [["dispatch", "late"]])
assert.deepEqual(delayed.accept(lateCalled), [], "重复事件不重复派遣")

// 无 input.started、缓存晚于 progress 的恢复路径。
let progressPart: any
const lateProgress = new Traffic(lookup, () => progressPart)
const pendingProgress = event("session.tool.progress", "ses_root", { id: "progress-call", metadata: { sessionID: "ses_child", status: "running" } })
assert.deepEqual(lateProgress.accept(pendingProgress), [])
progressPart = ({ name: "subagent", state: { status: "running", input: { description: "late progress" }, metadata: { sessionID: "ses_child" } } }) as any
assert.deepEqual(lateProgress.flush().map((p) => p.kind), ["dispatch"])
assert.deepEqual(lateProgress.accept(pendingProgress), [])

// 非 subagent 工具即使晚到也不得画派遣。
const otherTool = new Traffic(lookup, () => ({ name: "shell", state: { status: "running", input: {}, metadata: {} } }) as any)
assert.deepEqual(otherTool.accept(event("session.tool.progress", "ses_root", { metadata: { sessionID: "ses_child" } })), [])
const failedReport = new Traffic(lookup, () => toolPart())
assert.deepEqual(failedReport.accept(event("session.inbox.enqueued", "ses_root", {
  inboxID: "failed-inbox", item: { type: "synthetic", payload: {
    text: '<subagent sessionID="ses_child" state="failed">失败正文</subagent>',
    metadata: { source: "subagent", childID: "ses_child", agent: "worker-kimi", state: "failed" },
  } },
})).map((p) => [p.kind, p.label]), [["failed", "失败汇报"]])
for (const input of [{ prompt: "不得外发" }, { description: "   ", prompt: "不得外发" }]) {
 const fallback = new Traffic(lookup, () => toolPart())
 fallback.accept(event("session.tool.input.started", "ses_root", { name: "subagent" }))
 const packets = fallback.accept(event("session.tool.called", "ses_root", { input: { ...input, sessionID: "ses_child" } }))
 assert.equal(packets[0].summary, "子代理任务")
 assert.ok(!packets[0].summary.includes("不得外发"))
}
console.log("PASS: real ses IDs; nested tree; sibling relay; background ack/result/report; delayed cache; dedup; status; description-only fallback")
