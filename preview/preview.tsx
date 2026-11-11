import { render } from "solid-js/web"
import { createEffect, createSignal, onCleanup } from "solid-js"
import { MindMap, type MapNode } from "../src/map"
import type { Packet } from "../src/state"
import type { QuotaView } from "../src/services"
import type { Relation } from "../src/deck-graph"
import quotaSnapshot from "./sample-quota.json"
import "../src/panel.css"

const hostThemes = {
  light: { base: "#fff", layer01: "#fafafa", layer02: "#f2f2f2", text: "#161616", muted: "#5c5c5c", accent: "#3b5cf6", border: "#0000001a" },
  dark: { base: "#161616", layer01: "#242424", layer02: "#2e2e2e", text: "#fafafa", muted: "#aeaeae", accent: "#a2bcff", border: "#ffffff1a" },
}

function applyHostTheme(theme: "light" | "dark") {
  const value = hostThemes[theme], root = document.documentElement
  root.dataset.colorScheme = theme
  root.style.setProperty("--v2-background-bg-base", value.base)
  root.style.setProperty("--v2-background-bg-layer-01", value.layer01)
  root.style.setProperty("--v2-background-bg-layer-02", value.layer02)
  root.style.setProperty("--v2-text-text-base", value.text)
  root.style.setProperty("--v2-text-text-muted", value.muted)
  root.style.setProperty("--v2-text-text-accent", value.accent)
  root.style.setProperty("--v2-border-border-base", value.border)
}

function Preview() {
  const names = ["astra-ui-trade", "astra-water-transit", "astra-vehicles-sc", "astra-blocks-realty", "astra-qq-gateway", "astra-3d-artisan"]
  const titles = ["通用界面与交互", "会话和文件流转", "布局与拖拽", "共享协议与数据接口", "事件生命周期审查", "资产与视觉效果"]
  const params = new URLSearchParams(window.location.search)
  const dense = params.has("dense")
  const root: MapNode = { id: "ses_root", name: "build", title: "通用子代理监控系统", model: "gpt-6-astra", state: "running", elapsed: "18m 32s", tokens: 480000 }
  const regular: MapNode[] = [...names.map((name, i) => ({ id: `ses_${i}`, parentID: "ses_root", name, title: titles[i], model: "gpt-6-astra · xhigh", state: (i === 4 ? "done" : "running") as MapNode["state"], elapsed: `${i + 1}m 42s`, tokens: [14000, 88000, 290000, 42000, 185000, 12000][i] })), { id: "ses_test", parentID: "ses_2", name: "worker-kimi", title: "事件、布局与构建验证", model: "kimi-k3.1-pro", state: "running", elapsed: "26s", tokens: 4600 }]
  const denseNodes: MapNode[] = [{ id: "ses_dense", parentID: "ses_root", name: "dense-coordinator", title: "稠密关系自动适应 fixture", model: "fixture-model", state: "running", elapsed: "1m", tokens: 34000 }, ...Array.from({ length: 34 }, (_, i): MapNode => ({ id: `ses_dense_${i}`, parentID: "ses_dense", name: `fixture-worker-${String(i + 1).padStart(2, "0")}`, title: `明确测试节点 ${i + 1}`, model: "fixture-model", state: "running", elapsed: `${i + 1}s`, tokens: 1000 + i * 100 }))]
  const [extra, setExtra] = createSignal<MapNode[]>([])
  const [nodes, setNodes] = createSignal<MapNode[]>([root, ...(dense ? denseNodes : regular)])
  const [now, setNow] = createSignal(Date.now()), [growth, setGrowth] = createSignal(0)
  const [packets, setPackets] = createSignal<Packet[]>([])
  const [theme, setTheme] = createSignal<"light" | "dark">(params.get("theme") === "dark" ? "dark" : "light")
  const [edges] = createSignal<Relation[]>([{ from: "ses_5", to: "ses_2", label: "几何资产依赖", inferred: true }])
  const [selectedFixture, setSelectedFixture] = createSignal(dense ? "ses_dense" : "ses_test")
  const selectedName = () => allNodes().find((node) => node.id === selectedFixture())?.name
  const [serial, setSerial] = createSignal(0)
  const allNodes = () => [...nodes(), ...extra()]
  const previewNodes = () => allNodes().map((node) => ({ ...node, tokens: node.id === "ses_2" ? 290000 + growth() : node.tokens }))
  const quota = quotaSnapshot as QuotaView
  const timer = setInterval(() => setNow(Date.now()), 400)
  createEffect(() => applyHostTheme(theme()))
  onCleanup(() => clearInterval(timer))
  const finish = () => setPackets((ps) => [...ps, { id: String(Date.now()), from: "ses_4", to: "ses_root", at: Date.now(), seenAt: Date.now(), kind: "result", label: "结果返回", summary: "队列与消息合并验证完成。", evidence: "设计样例" }])
  const addNeighbor = () => {
    const id = `ses_extra_${serial()}`, parentID = selectedFixture(), name = `fixture-neighbor-${serial()}`
    setSerial((value) => value + 1)
    setExtra((items) => [...items, { id, parentID, name, title: "动态邻居测试节点", model: "fixture-model", state: "running", elapsed: "now", tokens: 2000 }])
  }
  const removeNeighbor = () => {
    const last = extra().at(-1)
    if (last) setExtra((items) => items.filter((node) => node.id !== last.id))
    else {
      const target = dense ? "ses_dense_33" : "ses_2"
      setNodes((items) => items.filter((node) => node.id !== target))
    }
  }
  const removeDragged = () => {
    const target = params.get("remove") || (dense ? "ses_dense_0" : "ses_2")
    setExtra((items) => items.filter((node) => node.id !== target))
    setNodes((items) => items.filter((node) => node.id !== target))
  }
  return <section class="atlas-panel atlas-pure atlas-expanded" data-mode={theme()} style={{ height: "100vh" }}>
    <div class="atlas-window-actions"><button title="模拟宿主主题切换" onClick={() => setTheme((value) => value === "light" ? "dark" : "light")}>{theme() === "light" ? "☾" : "☀"}</button><button title="模拟卡片生长" onClick={() => setGrowth((value) => value + 400000)}>＋400K</button><button title="模拟结果回传" onClick={finish}>↩</button></div>
    {params.has("controls") && <div class="atlas-preview-fixture-controls" style={{ position: "absolute", left: "8px", top: "8px", "z-index": 100, display: "flex", gap: "4px" }}><button title="新增邻居" onClick={addNeighbor}>+邻居</button><button title="移除邻居" onClick={removeNeighbor}>-邻居</button><button title="移除拖动节点" onClick={removeDragged}>删拖动</button></div>}
    <MindMap nodes={previewNodes()} rootID="ses_root" packets={packets()} now={now()} overview compact={params.has("compact")} quota={quota} analysis={{ enabled: true, state: "ready", updatedAt: Date.now(), summary: "preview fixture", edges: [], coveredIDs: allNodes().map((node) => node.id) }} onOpen={(id) => { document.title = `设计样例 · ${id}` }} edges={edges()} />
    <small style={{ position: "absolute", bottom: "8px", right: "18px", color: "var(--muted)", "font-size": "9px" }}>交互预览 · 任务与额度均为模拟数据</small>
  </section>
}
render(() => <Preview />, document.getElementById("app")!)
