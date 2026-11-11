export type TaskNode = { id: string; parentID?: string; tokens?: number }
export type Box = { id: string; x: number; y: number; w: number; h: number }

// Absolute, logarithmic usage bands: other tasks never shrink when one consumes more.
// The controller stays at the canvas center while cards pack around it.
export function arrange(nodes: TaskNode[], rootID: string, available: number) {
  let boxes = new Map<string, Box>()
  const width = Math.max(1040, available), pad = 32, gap = 32
  const columns = Math.max(4, Math.min(6, Math.floor((width - pad * 2 + gap) / 236)))
  const unit = (width - pad * 2 - (columns - 1) * gap) / columns
  // Preserve task order as usage changes, rather than continuously sorting by size.
  const ordered = nodes.map((node, index) => ({ node, index })).sort((a, b) =>
    Number(b.node.id === rootID) - Number(a.node.id === rootID) || a.index - b.index)
  const sizes = new Map<string, { w: number; h: number }>()
  for (const { node } of ordered) {
    const tokens = Number.isFinite(node.tokens) ? Math.max(0, node.tokens!) : 0
    const growth = Math.min(7, Math.log2(1 + tokens / 16000))
    const span = node.id === rootID || growth >= 4 ? 2 : 1
    const h = node.id === rootID ? 376 + Math.floor(growth) * 8
      : span === 2 ? 216 + Math.floor((growth - 4) * 3) * 8
      : 176 + Math.floor(growth * 2) * 8
    sizes.set(node.id, { w: span * unit + (span - 1) * gap, h })
  }
  const root = sizes.get(rootID)
  const area = [...sizes.values()].reduce((sum, b) => sum + (b.w + gap) * (b.h + gap), 0)
  let height = Math.max(480, Math.ceil(area / (width - pad * 2) * 1.4 / 8) * 8)
  const overlaps = (a: Box, b: Box) => a.x < b.x + b.w + gap - .01 && a.x + a.w + gap > b.x + .01 && a.y < b.y + b.h + gap - .01 && a.y + a.h + gap > b.y + .01
  for (let attempt = 0; attempt < 24; attempt++) {
    boxes = new Map()
    if (root) boxes.set(rootID, { id: rootID, x: (width - root.w) / 2, y: (height - root.h) / 2, ...root })
    let complete = true
    for (const { node } of ordered) {
      if (boxes.has(node.id)) continue
      const size = sizes.get(node.id)!
      const ys = new Set([pad, height - pad - size.h, (height - size.h) / 2])
      for (const b of boxes.values()) { ys.add(b.y - gap - size.h); ys.add(b.y + b.h + gap) }
      let best: Box | undefined, score = Infinity
      for (let column = 0; column < columns; column++) for (const y of ys) {
        const candidate = { id: node.id, x: pad + column * (unit + gap), y, ...size }
        if (y < pad || y + size.h > height - pad || candidate.x + size.w > width - pad + .01) continue
        if ([...boxes.values()].some((b) => overlaps(candidate, b))) continue
        const distance = ((candidate.x + size.w / 2 - width / 2) / width) ** 2 + ((y + size.h / 2 - height / 2) / height) ** 2
        if (distance < score) { best = candidate; score = distance }
      }
      if (!best) { complete = false; break }
      boxes.set(node.id, best)
    }
    if (complete) return { boxes, width, height }
    height = Math.ceil(height * 1.18 / 8) * 8
  }
  return { boxes, width, height }
}
