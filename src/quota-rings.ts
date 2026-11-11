import type { QuotaView } from "./services"
type Row = QuotaView["rows"][number]
export type Ring = { key: string; label: string; color: string; percent?: number; value: string; rows: Row[] }

function source(row: Row) {
  const id = (row.group ?? row.providerID ?? "unknown").toLowerCase()
  if (id === "claude-gpt") return { key: id, label: "Claude / GPT", color: "#bb8af4" }
  if (/^minimax(?:[._-]|$)/.test(id)) return { key: "minimax", label: "MiniMax", color: "#ff6b6b" }
  if (/^gemini(?:[._-]|$)/.test(id)) return { key: "gemini", label: "Gemini", color: "#ae80f5" }
  if (/^claude(?:[._-]|$)/.test(id)) return { key: "claude", label: "Claude", color: "#c39af7" }
  if (/^(openai|gpt)(?:[._-]|$)/.test(id)) return { key: "openai", label: "GPT", color: "#ffffff" }
  if (/^deepseek(?:[._-]|$)/.test(id)) return { key: "deepseek", label: "DeepSeek", color: "#399bff" }
  if (/^(kimi|moonshot)(?:[._-]|$)/.test(id)) return { key: "kimi", label: "Kimi", color: "#66b4ff" }
  if (/^(qwen|doubao|glm|zhipu)(?:[._-]|$)/.test(id)) return { key: id, label: row.providerID ?? "国产模型", color: "#399bff" }
  if (/^google(?:[._-]|$)/.test(id)) return { key: "google", label: "Google", color: "#ae80f5" }
  return { key: id, label: row.providerID ?? "未知来源", color: "#96a9bd" }
}

export function quotaRings(input: readonly Row[]): Ring[] {
  const groups = new Map<string, { source: ReturnType<typeof source>; rows: Row[] }>()
  for (const row of input) {
    // Display text is not evidence of a balance or of provider identity.
    if (row.percent === undefined && row.valueType !== "amount") continue
    const s = source(row), group = groups.get(s.key) ?? { source: s, rows: [] }
    group.rows.push(row); groups.set(s.key, group)
  }
  return [...groups.values()].map(({ source, rows }) => {
    const limiting = rows.filter((r) => r.percent !== undefined).reduce<Row | undefined>((best, row) => !best || row.percent! < best.percent! ? row : best, undefined)
    return { ...source, percent: limiting?.percent, value: (limiting ?? rows[0]).value, rows }
  }).sort((a, b) => a.key === "openai" ? -1 : b.key === "openai" ? 1 : a.key.localeCompare(b.key))
}
