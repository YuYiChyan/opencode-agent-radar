import type { Data } from "@opencode/client/solid"
import { familyOf, type Packet } from "./state"

export function analysisFamily(rootID: string, data: Data, packets: readonly Packet[], limit = 80) {
  const family = familyOf(rootID, data.session.list()), byID = new Map(family.map((n) => [n.id, n]))
  const recent = new Map<string, number>()
  packets.forEach((p, i) => { if (byID.has(p.from) && byID.has(p.to)) { recent.set(p.from, i); recent.set(p.to, i) } })
  const ranked = [...family].sort((a, b) => Number(b.id === rootID) - Number(a.id === rootID)
    || Number(data.session.status(b.id) === "running") - Number(data.session.status(a.id) === "running")
    || (recent.get(b.id) ?? -1) - (recent.get(a.id) ?? -1)
    || b.time.created - a.time.created || a.id.localeCompare(b.id))
  const chosen = new Map<string, typeof family[number]>()
  for (const info of ranked) {
    const chain = [], seen = new Set<string>()
    let current: typeof info | undefined = info
    while (current && !chosen.has(current.id) && !seen.has(current.id)) { seen.add(current.id); chain.unshift(current); current = current.parentID ? byID.get(current.parentID) : undefined }
    if (chosen.size + chain.length > limit) continue
    for (const node of chain) chosen.set(node.id, node)
  }
  return [...chosen.values()]
}
