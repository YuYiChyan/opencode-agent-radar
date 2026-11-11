import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, untrack } from "solid-js"
import { compactTokens, stateLabels, type Packet, type RunState } from "./state"
import type { Box } from "./layout"
import { arrangeFocus, connection, deckWindow, fitGraph, focusedGraph, usageScale, type Relation } from "./deck-graph"
import { QuotaRings } from "./rings"
import type { AnalysisView, QuotaView } from "./services"

export type MapNode = { id: string; parentID?: string; name: string; title: string; model: string; state: RunState; elapsed: string; tokens?: number }
const positions = new Map<string, Record<string, { x: number; y: number }>>()
type Flight = { key: string; packet: Packet; at: number; path: string; x: number; y: number }
type Dock = { key: number; node: MapNode; from: Box; to: Box }

export function MindMap(props: { nodes: MapNode[]; rootID: string; layoutKey?: string; packets: Packet[]; now: number; onOpen: (id: string) => void; overview?: boolean; compact?: boolean; quota?: QuotaView; summary?: string; analysis?: AnalysisView; edges?: Relation[] }) {
  let shell!: HTMLDivElement, deck!: HTMLDivElement, graphViewport!: HTMLDivElement, controller: HTMLElement | undefined
  const cards = new Map<string, HTMLElement>(), graphCards = new Map<string, HTMLElement>()
  const [size, setSize] = createSignal({ width: 1100, height: 800 })
  const [graphSize, setGraphSize] = createSignal({ width: 620, height: 430 })
  const [deckSize, setDeckSize] = createSignal({ width: 400, height: 420 })
  const [selected, setSelected] = createSignal<string>()
  const [page, setPage] = createSignal(0)
  const [manual, setManual] = createSignal<Record<string, { x: number; y: number }>>({})
  const [dragging, setDragging] = createSignal<string>()
  const root = () => props.nodes.find((n) => n.id === props.rootID)
  const agents = createMemo(() => props.nodes.filter((n) => n.id !== props.rootID))
  const deckNodes = createMemo(() => agents().filter((n) => n.id !== selected()))
  const visible = createMemo(() => deckWindow(deckNodes(), page()))
  const front = () => visible().at(-1)
  const chosen = () => props.nodes.find((n) => n.id === selected())
  const key = () => `${props.layoutKey ?? props.rootID}\n${props.compact ? "compact" : "wide"}\n${selected() ?? ""}`
  createEffect(() => { props.layoutKey; props.rootID; setSelected(undefined); setPage(0) })
  createEffect(() => { if (selected() && !agents().some((n) => n.id === selected())) setSelected(undefined); if (page() >= deckNodes().length) setPage(0) })
  createEffect(() => { const id = key(); setManual(positions.get(id) ?? {}); nodeDrag = undefined; setDragging(undefined); setDragCamera(undefined) })
  const graph = createMemo(() => focusedGraph(props.nodes, selected(), props.packets, props.edges))
  const graphNodes = createMemo(() => props.nodes.filter((n) => graph().ids.includes(n.id)))
  const relationNote = () => {
    const a = props.analysis
    if (a?.state === "error") return `关联分析失败 · ${a.error ?? "请检查分析设置"}`
    if (a?.enabled === false) return "AI 关联分析已关闭 · 当前显示已观察关系"
    if (a?.coveredIDs && selected() && !a.coveredIDs.includes(selected()!)) return "该代理未纳入本轮有界分析 · 显示已观察关系"
    if (a?.state === "running") return "正在分析公开任务与协作关系…"
    if (a?.state !== "ready") return "等待协作分析 · 先显示已观察关系"
    return graph().edges.some((e) => e.kind !== "task" && e.from !== props.rootID && e.to !== props.rootID)
      ? "细线：隶属 · 实线：已观察 · 虚线：AI 推断"
      : "当前公开证据不足 · 暂仅显示任务隶属与已观察记录"
  }
  const layout = createMemo(() => arrangeFocus(graphNodes(), selected(), graph().edges, props.compact))
  const stackScale = () => Math.min(1.1, Math.max(.5, Math.min(deckSize().width / 455, deckSize().height / 340)))
  const compactScale = () => Math.min(1, Math.max(.35, Math.min(deckSize().width / 320, deckSize().height / (size().height < 720 ? 340 : 380))))
  const box = (id: string) => {
    const b = layout().boxes.get(id), p = manual()[id]
    return b && p ? { ...b, x: Math.max(0, Math.min(layout().width - b.w, p.x)), y: Math.max(0, Math.min(layout().height - b.h, p.y)) } : b
  }
  const camera = createMemo(() => fitGraph(graph().ids.map(box).filter((b): b is Box => !!b), graphSize().width, graphSize().height))
  const [dragCamera, setDragCamera] = createSignal<ReturnType<typeof fitGraph>>()
  const view = () => dragCamera() ?? camera()
  const scale = () => view().scale
  const [dock, setDock] = createSignal<Dock>()
  let dockTimer: ReturnType<typeof setTimeout> | undefined, dockSerial = 0
  createEffect(() => { props.layoutKey; props.rootID; clearTimeout(dockTimer); setDock(undefined) })
  const select = (id: string) => {
    if (selected() === id) { clearTimeout(dockTimer); setDock(undefined); setSelected(undefined); return }
    const node = agents().find((n) => n.id === id), source = cards.get(id)?.querySelector<HTMLElement>(".atlas-deck-glass") ?? graphCards.get(id)
    if (node && source?.isConnected && controller?.isConnected) {
      const origin = shell.getBoundingClientRect(), a = source.getBoundingClientRect(), b = controller.getBoundingClientRect()
      setDock({ key: ++dockSerial, node, from: { id, x: a.x - origin.x, y: a.y - origin.y, w: a.width, h: a.height }, to: { id, x: b.x - origin.x, y: b.y - origin.y, w: b.width, h: b.height } })
      clearTimeout(dockTimer); dockTimer = setTimeout(() => setDock(undefined), 560)
    }
    setSelected(id)
  }
  const browse = (direction: number) => { const n = deckNodes().length; if (n > 1) setPage((p) => ((p + direction) % n + n) % n) }
  onCleanup(() => clearTimeout(dockTimer))
  const reset = () => { positions.delete(key()); setManual({}); setDragCamera(undefined) }
  onMount(() => {
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const value = { width: entry.contentRect.width, height: entry.contentRect.height }
        if (entry.target === shell) setSize(value)
        if (entry.target === deck) setDeckSize(value)
        if (entry.target === graphViewport) setGraphSize(value)
      }
    })
    observer.observe(shell); observer.observe(deck)
    let wheelTotal = 0, lastWheel = 0
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || deckNodes().length < 2) return
      event.preventDefault()
      wheelTotal += Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      const now = Date.now()
      if (Math.abs(wheelTotal) >= 22 && now - lastWheel >= 130) { browse(Math.sign(wheelTotal)); wheelTotal = 0; lastWheel = now }
    }
    deck.addEventListener("wheel", wheel, { passive: false })
    createEffect(() => { if (selected() && graphViewport) { const target = graphViewport; observer.observe(target); onCleanup(() => observer.unobserve(target)) } })
    onCleanup(() => { observer.disconnect(); deck.removeEventListener("wheel", wheel) })
  })

  let nodeDrag: { id: string; x: number; y: number; start: Box; scale: number; moved: boolean } | undefined
  const suppressed = new Set<string>()
  const startDrag = (id: string, e: PointerEvent) => {
    const b = box(id)
    if (e.button !== 0 || !b) return
    e.stopPropagation(); suppressed.delete(id)
    setDragCamera(camera())
    nodeDrag = { id, x: e.clientX, y: e.clientY, start: b, scale: scale(), moved: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const moveDrag = (e: PointerEvent) => {
    if (!nodeDrag) return
    const dx = e.clientX - nodeDrag.x, dy = e.clientY - nodeDrag.y
    if (!nodeDrag.moved && Math.hypot(dx, dy) < 5) return
    nodeDrag.moved = true; setDragging(nodeDrag.id)
    const x = Math.max(0, Math.min(layout().width - nodeDrag.start.w, nodeDrag.start.x + dx / nodeDrag.scale))
    const y = Math.max(0, Math.min(layout().height - nodeDrag.start.h, nodeDrag.start.y + dy / nodeDrag.scale))
    setManual((old) => ({ ...old, [nodeDrag!.id]: { x, y } }))
  }
  const finishDrag = () => {
    if (nodeDrag?.moved) { suppressed.add(nodeDrag.id); positions.set(key(), manual()); if (positions.size > 48) positions.delete(positions.keys().next().value!) }
    nodeDrag = undefined; setDragging(undefined); setDragCamera(undefined)
  }
  createEffect(() => { const ids = graph().ids; untrack(() => { if (nodeDrag && !ids.includes(nodeDrag.id)) finishDrag() }) })

  const [flights, setFlights] = createSignal<Flight[]>([])
  const animated = new Set<string>()
  const isReturn = (p: Packet) => p.kind === "result" || (p.kind === "report" && p.stage === "已送达")
  const anchor = (id: string) => {
    const el = id === selected() ? controller : (selected() ? graphCards.get(id) : undefined) ?? (id === props.rootID && !selected() ? controller : cards.get(id))
    const bounds = shell.getBoundingClientRect()
    if (el?.isConnected) { const r = el.getBoundingClientRect(); return { x: r.x - bounds.x + r.width / 2, y: r.y - bounds.y + r.height / 2 } }
    return id === props.rootID ? { x: size().width * .8, y: 170 } : { x: size().width * .22, y: size().height * .76 }
  }
  createEffect(() => {
    props.layoutKey; props.rootID
    animated.clear(); setFlights([])
  })
  createEffect(() => {
    const now = props.now, packets = props.packets
    if (!shell) return
    untrack(() => {
      const active = flights().filter((f) => now - f.at < 1800)
      const ids = new Set(props.nodes.map((n) => n.id))
      for (const packet of packets) {
        const id = `${packet.id}:${packet.stage ?? ""}`
        if (animated.has(id) || now - (packet.deliveredAt ?? packet.seenAt ?? 0) > 10000 || !ids.has(packet.from) || !ids.has(packet.to)) continue
        animated.add(id)
        const from = anchor(packet.from), to = anchor(packet.to), bend = Math.max(70, Math.abs(to.x - from.x) * .4) * (to.x >= from.x ? 1 : -1)
        active.push({ key: id, packet, at: now, x: from.x, y: from.y, path: `path("M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}")` })
      }
      if (animated.size > 3200) { const keep = [...animated].slice(-1600); animated.clear(); keep.forEach((id) => animated.add(id)) }
      if (active.length !== flights().length || active.some((f, i) => f.key !== flights()[i]?.key)) setFlights(active.slice(-8))
    })
  })

  return <div class="atlas-deck-shell" classList={{ "is-compact": !!props.compact, "has-selection": !!selected(), "is-short": size().height < 720, "is-tiny": size().height < 650 }} ref={shell}
    style={{ "--compact-scale": compactScale() }} onKeyDown={(e) => {
    if (e.key === "Escape" && selected()) { e.preventDefault(); e.stopPropagation(); setSelected(undefined) }
  }}>
    <svg class="atlas-structure-lines" viewBox="0 0 1000 800" preserveAspectRatio="none" aria-hidden="true"><g class="atlas-flow-wide"><path d="M34 105 V68 H146 M160 68 H188 M808 734 H955 V678"/><path d="M60 708 C310 750 330 406 565 402 S795 346 953 320"/><path d="M82 736 C340 776 358 434 583 430 S816 372 972 346" class="is-stream"/><path d="M360 726 H406 M383 703 V749 M682 108 H746 M714 100 V116"/><circle cx="197" cy="68" r="3"/><circle cx="953" cy="320" r="3"/></g><g class="atlas-flow-compact"><path d="M62 116 V68 H168 M834 732 H938 V684 M74 710 C180 588 118 422 394 390 S882 320 930 240"/><path d="M90 732 C210 608 146 446 410 414 S894 346 946 264" class="is-stream"/><path d="M86 294 H162 M124 282 V306 M846 490 H914"/><circle cx="930" cy="240" r="3"/></g></svg>
    <Show when={root()}>{(node) => <article class="atlas-controller" classList={{ "is-selected": !!chosen() }} ref={(el) => { controller = el }} aria-label={chosen() ? "选中代理预览位" : "主统筹代理"}>
      <Show when={chosen()?.id} keyed fallback={<>
      <div class="atlas-controller-identity"><div class="atlas-node-top"><span class="atlas-index">CONTROL</span><span class="atlas-status" data-state={node().state} title={stateLabels[node().state]}><i /></span></div>
        <h3><button onClick={() => props.onOpen(props.rootID)}>统筹 · {node().name}</button></h3>
        <p class="atlas-controller-model" title={node().model}>{node().model}</p>
        <span class="atlas-controller-usage" title={`累计 tokens：${node().tokens ?? "等待同步"}`}>{compactTokens(node().tokens)}</span>
      </div><QuotaRings quota={props.quota} fallbackValue={compactTokens(node().tokens)} /></>}>{(id) => {
        const active = () => props.nodes.find((n) => n.id === id)!
        return <><button class="atlas-primary-selected" onClick={() => select(id)} aria-label={`收起 ${active().name}，返回预览模式`}>
          <span class="atlas-controller-identity"><span class="atlas-node-top"><span class="atlas-index">AGENT · 点击收起</span><span class="atlas-status" data-state={active().state}><i /></span></span><strong class="atlas-primary-name">{active().name}</strong><span class="atlas-controller-model">{active().model}</span><span class="atlas-controller-usage">{compactTokens(active().tokens)} · {stateLabels[active().state]}</span></span>
          <span class="atlas-primary-detail"><span class="atlas-task">{active().title}</span><span class="atlas-primary-time">{active().elapsed}</span></span>
        </button><button class="atlas-primary-open" onClick={() => props.onOpen(id)} aria-label={`进入 ${active().name} 会话`}>进入会话 ↗</button></>
      }}</Show>
    </article>}</Show>

    <div class="atlas-deck" ref={deck} aria-label="子代理 3D 卡堆" onKeyDown={(e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); browse(1) }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); browse(-1) }
    }}>
      <div class="atlas-deck-perspective"><div class="atlas-deck-scene" style={{ "--deck-scale": stackScale() }}>
        <For each={visible().map((n) => n.id)}>{(id, index) => {
          onCleanup(() => cards.delete(id))
          const node = () => agents().find((n) => n.id === id)!
          return <button class="atlas-deck-card" classList={{ "is-packed": !!props.compact && !!selected(), "is-complete": node().state === "done" }} ref={(el) => cards.set(id, el)}
            style={{ "--card-i": index(), "--usage-scale": usageScale(node().tokens), "--card-jitter": `${[.4, -.6, .7, -.3, .5, -.7, .1][index()]}deg`, "--card-nudge": `${[1, -2, 2, -1, 3, 0, -2][index()]}px` }} tabindex={props.compact && selected() ? -1 : 0} aria-label={`${node().name} · ${node().title}，抽出并查看关联`} onClick={() => select(id)}>
            <span class="atlas-deck-glass"><span class="atlas-deck-tab"><span class="atlas-status" data-state={node().state}><i /></span><strong>{node().name}</strong><small>{compactTokens(node().tokens)}</small></span>
              <span class="atlas-deck-detail"><span class="atlas-task">{node().title}</span><span class="atlas-deck-model">{node().model}</span><span class="atlas-deck-state">{stateLabels[node().state]} · {node().elapsed}</span></span>
            </span>
          </button>
        }}</For>
      </div></div>
      <Show when={props.compact && selected() && front()}><button class="atlas-deck-unpack" onClick={() => { const node = front(); if (node) select(node.id) }} aria-label={`抽出 ${front()?.name}`}><span>{front()?.name} ↗</span></button></Show>
      <Show when={!agents().length}><span class="atlas-deck-empty">等待子代理</span></Show>
      <Show when={deckNodes().length > 1}><nav class="atlas-deck-nav" aria-label="循环浏览卡堆"><button onClick={() => browse(-1)} aria-label="上一张，循环">↖</button><button onClick={() => browse(1)} aria-label="下一张，循环">↘</button></nav></Show>
    </div>

    <Show when={chosen()}>{(node) => <section class="atlas-relations" aria-label={`${node().name} 的逻辑关系图`}>
      <div class="atlas-relation-toolbar"><button class="atlas-open-session" onClick={() => props.onOpen(node().id)} title="进入选中的子代理会话">{node().name}<span>↗</span></button><div class="atlas-relation-tools"><span class="atlas-auto-fit">自动适应</span><button onClick={reset} aria-label="恢复关系图布局并自动适应">↺</button><button onClick={() => setSelected(undefined)} aria-label="收回卡片">×</button></div></div>
      <p class="atlas-relation-note" title={props.summary} role="status">{relationNote()}</p>
      <div class="atlas-relation-viewport" ref={graphViewport}><div class="atlas-relation-sizer">
        <div class="atlas-relation-canvas" style={{ width: `${layout().width}px`, height: `${layout().height}px`, transform: `translate(${view().x}px,${view().y}px) scale(${scale()})` }}>
          <svg class="atlas-relation-lines" width={layout().width} height={layout().height}><For each={graph().edges}>{(edge) => <Show when={box(edge.from) && box(edge.to)}><path d={connection(box(edge.from)!, box(edge.to)!)} classList={{ "is-inferred": edge.inferred, "is-file": edge.kind === "file", "is-task": edge.kind === "task" }}><title>{(edge.labels ?? [edge.label]).join("\n")}{edge.inferred ? "（AI 推断）" : "（已观察）"}</title></path></Show>}</For></svg>
          <For each={graph().ids}>{(id) => {
            onCleanup(() => graphCards.delete(id))
            const info = () => props.nodes.find((n) => n.id === id)
            return <Show when={info() && box(id)}>{(b) => <button ref={(el) => graphCards.set(id, el)} class="atlas-relation-node" classList={{ "is-focus": id === selected(), "is-dragging": dragging() === id }}
              style={{ left: `${b().x}px`, top: `${b().y}px`, width: `${b().w}px`, height: `${b().h}px` }} onPointerDown={(e) => startDrag(id, e)} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}
              onClick={() => { if (suppressed.delete(id)) return; if (id === props.rootID) setSelected(undefined); else select(id) }}>
              <span class="atlas-relation-name"><span class="atlas-status" data-state={info()!.state}><i /></span>{id === props.rootID ? `统筹 · ${info()!.name}` : info()!.name}</span><span class="atlas-task">{info()!.title}</span><small>{compactTokens(info()!.tokens)} · {info()!.model}</small>
            </button>}</Show>
          }}</For>
        </div>
      </div></div>
    </section>}</Show>
    <Show when={!selected() && agents().length}><span class="atlas-select-hint">选一个子代理，看看它有没有在摸鱼。</span></Show>
    <Show when={dock()} keyed>{(flight) => <div class="atlas-dock-flight" aria-hidden="true" style={{ left: `${flight.to.x}px`, top: `${flight.to.y}px`, width: `${flight.to.w}px`, height: `${flight.to.h}px`, "--dock-x": `${flight.from.x - flight.to.x}px`, "--dock-y": `${flight.from.y - flight.to.y}px`, "--dock-sx": flight.from.w / flight.to.w, "--dock-sy": flight.from.h / flight.to.h }}><strong>{flight.node.name}</strong><span>{flight.node.title}</span></div>}</Show>
    <div class="atlas-live-motion" aria-hidden="true"><For each={flights()}>{(f) => <Show when={f.packet.kind !== "artifact"} fallback={<i class="atlas-artifact-pulse" style={{ left: `${f.x}px`, top: `${f.y}px` }} />}>
      <Show when={f.packet.kind === "file" || f.packet.kind === "status" || f.packet.stage === "入队"} fallback={<div class="atlas-flight" classList={{ "atlas-return-flight": isReturn(f.packet), "atlas-dispatch-flight": f.packet.kind === "dispatch", "atlas-relay-flight": f.packet.kind === "relay" || f.packet.kind === "failed" }} style={{ "offset-path": f.path, "--flight-w": "190px", "--flight-h": "100px" }}><span>{f.packet.label}</span><small>{f.packet.summary.slice(0, 64)}</small></div>}><i class="atlas-file-dot" style={{ "offset-path": f.path }} /></Show>
    </Show>}</For></div>
  </div>
}
