import type { SessionInfo, SessionListInput, SessionListOutput } from "@opencode/client"

// Retained from the existing Agent Radar: public, paginated family discovery.
export async function discoverChildren(root: string, list: (input: SessionListInput) => Promise<SessionListOutput>, receive: (info: SessionInfo) => void, cancelled: () => boolean): Promise<Set<string>> {
  const ids = new Set<string>(), seen = new Set([root]), queue = [root]
  for (let i = 0; i < queue.length && !cancelled();) {
    const batch = queue.slice(i, i + 4)
    i += batch.length
    await Promise.all(batch.map(async (parentID) => {
      let cursor: string | undefined
      do {
        if (cancelled()) return
        const page = await list(cursor ? { cursor, limit: 100 } : { parentID, order: "desc", limit: 100 })
        if (cancelled()) return
        for (const info of page.data) {
          if (seen.has(info.id)) continue
          seen.add(info.id); ids.add(info.id); queue.push(info.id); receive(info)
        }
        cursor = page.cursor.next ?? undefined
      } while (cursor)
    }))
  }
  return ids
}
