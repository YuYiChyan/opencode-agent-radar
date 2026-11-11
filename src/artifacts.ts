import type { OpenCodeEvent, SessionInfo, SessionMessageAssistantTool } from "@opencode/client"
import type { Packet } from "./state"

const PENDING_MS = 10_000
const WRITE_MS = 30 * 60_000
const MAX_PENDING = 300
const MAX_FILES = 1200
const MAX_SEEN = 2000
const MAX_PATHS = 80
const MAX_VERSIONS = 4

type Change = { path: string; removed?: boolean }
type Parameters = { file?: string; patch?: Change[] }
type Call = { name?: string; input?: Parameters; directory?: string; started?: number; touched: number }
type Success = {
  id: string; key: string; session: string; message: string; tool: string
  at: number; since: number; directoryRead: boolean; failed: boolean
}
type Write = { session: string; event: string; at: number; since: number; removed?: boolean }
type Mode = "patch" | "write" | "read"

function mode(name: string): Mode | undefined {
  // Deliberately not suffix-matching arbitrary MCP tools or shell commands.
  const local = name.replace(/^functions\./, "")
  if (local === "patch" || local === "apply_patch") return "patch"
  if (["write", "write_file", "edit", "edit_file", "multiedit", "multi_edit"].includes(local)) return "write"
  if (local === "read" || local === "read_file") return "read"
}

function pathString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 && !/[\x00-\x1f\x7f]/.test(value)
    ? value : undefined
}

/** Parse only patch headers; never retain patch bodies or write/edit contents. */
function patchPaths(text: string): Change[] {
  const changes: Change[] = []
  let sections = 0
  let active = false
  let current: Change | undefined
  // Header matching avoids splitting (and retaining) every line of a huge diff.
  const headers = /^\*\*\* (Begin Patch|End Patch|(?:Add File|Update File|Delete File|Move to):[^\r\n]*)\r?$/gm
  for (const match of text.matchAll(headers)) {
    const header = match[1]
    if (header === "Begin Patch") { active = true; continue }
    if (header === "End Patch") break
    if (!active) continue
    const colon = header.indexOf(":")
    const operation = header.slice(0, colon)
    const path = pathString(header.slice(colon + 1).trim())
    if (operation === "Move to") {
      // Update + Move produces the destination, NOT the now-absent source.
      if (current && !current.removed && path) {
        const source = current.path
        current.path = path
        changes.push({ path: source, removed: true })
        current = undefined
      }
      continue
    }
    current = undefined
    if (!path || sections >= MAX_PATHS) continue
    sections++
    current = { path, ...(operation === "Delete File" ? { removed: true } : {}) }
    changes.push(current)
  }
  return changes
}

function parameters(input: Record<string, unknown>): Parameters {
  const file = pathString(input.filePath) ?? pathString(input.path) ?? pathString(input.file_path)
  const patch = typeof input.patchText === "string" ? input.patchText : typeof input.patch === "string" ? input.patch : undefined
  return { file, ...(patch === undefined ? {} : { patch: patchPaths(patch) }) }
}

function windowsAbsolute(path: string): boolean {
  return /^[a-z]:[\\/]/i.test(path) || /^\\\\[^\\]/.test(path)
}

/** Pure, lexical paths: no Node builtins, filesystem IO, realpath or case guessing. */
function absolute(path: string): string | undefined {
  let root: string
  let rest: string
  if (/^[a-z]:[\\/]/i.test(path)) {
    root = `${path[0].toUpperCase()}:/`
    rest = path.slice(3).replace(/\\/g, "/")
  } else if (/^\\\\[^\\]/.test(path)) {
    const parts = path.slice(2).replace(/\\/g, "/").split("/")
    const server = parts.shift(), share = parts.shift()
    if (!server || !share || [server, share].some((p) => p === "." || p === "..")) return undefined
    root = `//${server}/${share}/`
    rest = parts.join("/")
  } else if (path.startsWith("/")) {
    root = "/"
    rest = path.slice(1)
  } else return undefined
  const segments: string[] = []
  for (const segment of rest.split("/")) {
    if (!segment || segment === ".") continue
    if (segment === "..") segments.pop()
    else segments.push(segment)
  }
  return root + segments.join("/")
}

function canonical(path: string, directory?: string): string | undefined {
  if (!pathString(path) || /^~(?:[\\/]|$)/.test(path)) return undefined
  if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) return undefined
  const windows = windowsAbsolute(path) || (!!directory && windowsAbsolute(directory))
  // Explicit directory requests must never become file receipts.
  if (/[\/]$/.test(path) || (windows && /\\$/.test(path)) || /^(?:\.|\.\.)$/.test(path)) return undefined
  if (/(?:^|\/)\.\.?$/.test(windows ? path.replace(/\\/g, "/") : path)) return undefined
  const direct = absolute(path)
  if (direct) return direct
  if (!directory || !pathString(directory)) return undefined
  // Windows rooted-but-drive-less paths are ambiguous, not relative files.
  if (windows && /^[\\/]/.test(path)) return undefined
  const base = absolute(directory)
  if (!base) return undefined
  const relative = windows ? path.replace(/\\/g, "/") : path
  // Keep the UNC root while resolving a relative path against it.
  return absolute(`${base.replace(/\/$/, "")}/${relative}`.replace(/^\/\/(?=[^/])/, windows ? "\\\\" : "//"))
}

function outputFlags(content: readonly { type: string; text?: string }[], metadata?: Record<string, unknown>) {
  const first = content.find((part) => part.type === "text")
  // Only inspect the tool's output envelope prefix, never copy its body to a packet/cache.
  const head = first?.text?.slice(0, 2048).trimStart() ?? ""
  const directoryRead = metadata?.isDirectory === true || metadata?.directory === true ||
    metadata?.type === "directory" || metadata?.kind === "directory" ||
    /^(?:Read directory\b|Directory listing\b|Listing directory\b)/i.test(head) ||
    /^<path>[^<]*<\/path>\s*<type>directory<\/type>/i.test(head) || /^<type>directory<\/type>/i.test(head)
  const failed = metadata?.isError === true || metadata?.success === false ||
    ["error", "failed", "cancelled", "interrupted"].includes(String(metadata?.status)) ||
    /^(?:Error:|Error executing tool\b|Error reading (?:file|directory)\b|apply_patch verification failed\b|Failed to (?:read|write|edit|apply)\b)/i.test(head)
  return { directoryRead, failed }
}

/**
 * One instance per server connection/identity, just like its lookup/tool caches.
 * OpenCode 2.2.7 filesystem.changed has no sessionID; artifact.updated has empty
 * data. Neither can attribute shell output, so both are intentionally ignored.
 */
export class Artifacts {
  private calls = new Map<string, Call>()
  private pending = new Map<string, Success>()
  private files = new Map<string, Write[]>()
  private seen = new Set<string>()

  constructor(
    private lookup: (id: string) => SessionInfo | undefined,
    private tool: (sid: string, mid: string, tid: string) => SessionMessageAssistantTool | undefined,
  ) {}

  accept(event: OpenCodeEvent): Packet[] {
    if (event.type !== "session.tool.input.started" && event.type !== "session.tool.called" &&
      event.type !== "session.tool.success" && event.type !== "session.tool.failed") return []
    const now = Date.now()
    this.prune(now)
    const d = event.data
    const key = JSON.stringify([d.sessionID, d.assistantMessageID, d.id])
    if (this.seen.has(`event:${event.id}`) || this.seen.has(`call:${key}`)) return []
    this.remember(`event:${event.id}`)
    if (event.type === "session.tool.failed") { this.finish(key); return [] }

    const call: Call = this.calls.get(key) ?? { touched: now }
    call.touched = now
    call.directory ??= this.lookup(d.sessionID)?.location?.directory
    if (event.type === "session.tool.input.started") call.name = event.data.name
    if (event.type === "session.tool.called") {
      call.input = parameters(event.data.input)
      call.started = event.created
    }
    this.calls.set(key, call)
    if (this.calls.size > MAX_PENDING) this.finish(this.calls.keys().next().value!)

    if (call.name && !mode(call.name)) { this.finish(key); return [] }
    if (event.type === "session.tool.success") {
      // The pending record stores flags and IDs, NOT success content or patch bodies.
      if (!this.pending.has(key)) this.pending.set(key, {
        id: event.id, key, session: d.sessionID, message: d.assistantMessageID, tool: d.id,
        at: event.created, since: now, ...outputFlags(event.data.content, event.data.metadata),
      })
      if (this.pending.size > MAX_PENDING) this.finish(this.pending.keys().next().value!)
    }
    return this.drain(now)
  }

  flush(): Packet[] {
    const now = Date.now()
    this.prune(now)
    return this.drain(now)
  }

  private drain(now: number): Packet[] {
    const packets: Packet[] = []
    // A delayed writer can precede a read already waiting on its cache.
    for (const success of [...this.pending.values()].sort((a, b) => a.at - b.at)) {
      const result = this.resolve(success, now)
      if (result === undefined) continue
      packets.push(...result)
      this.finish(success.key)
    }
    return packets
  }

  private resolve(success: Success, now: number): Packet[] | undefined {
    if (success.failed || !Number.isFinite(success.at)) return []
    const call = this.calls.get(success.key)
    if (!call) return []
    const part = this.tool(success.session, success.message, success.tool)
    if (part?.state.status === "error") return []
    call.name ??= part?.name
    if (!call.name) return undefined
    const kind = mode(call.name)
    if (!kind) return []
    if (part && part.state.status !== "streaming") {
      const cached = parameters(part.state.input)
      // A running cache entry can still have input: {} when success arrives.
      // Fill absent fields on every retry; actual called arguments win.
      call.input = { file: call.input?.file ?? cached.file, patch: call.input?.patch ?? cached.patch }
      if (part.time?.ran !== undefined) call.started ??= part.time.ran
    }
    if (!call.input) return undefined
    const info = this.lookup(success.session)
    if (!info) return undefined
    call.directory ??= info.location?.directory
    if (kind === "read") return this.receive(success, call, now)

    const changes = kind === "patch" ? call.input.patch : call.input.file ? [{ path: call.input.file }] : undefined
    if (!changes) return undefined
    if (!changes.length) return []
    // Unknown base directory may arrive through lookup within the pending window.
    if (!call.directory && changes.some((item) => !absolute(item.path))) return undefined
    const paths = new Map<string, boolean>()
    for (const change of changes) {
      const path = canonical(change.path, call.directory)
      if (path) paths.set(path, change.removed === true)
    }
    const packets: Packet[] = []
    for (const [path, removed] of paths) {
      this.record(path, { session: success.session, event: success.id, at: success.at, since: now, removed })
      if (!removed) packets.push({
        id: `${success.id}:artifact:${packets.length}`, from: success.session, to: success.session,
        at: success.at, seenAt: now, kind: "artifact", label: "文件产出", summary: path,
        evidence: "session.tool.success",
      })
    }
    return packets
  }

  private receive(success: Success, call: Call, now: number): Packet[] | undefined {
    if (success.directoryRead) return []
    if (!call.input?.file) return undefined
    if (!call.directory && !absolute(call.input.file)) return undefined
    const path = canonical(call.input.file, call.directory)
    if (!path) return []
    const versions = this.files.get(path)
    if (!versions) return undefined
    const started = call.started !== undefined && call.started <= success.at ? call.started : success.at
    // Concurrent writes are ambiguous: never claim which version a racing read saw.
    if (versions.some((write) => write.at > started && write.at <= success.at)) return []
    const write = versions.find((candidate) => candidate.at <= started)
    if (!write) return undefined
    if (write.removed || write.session === success.session || success.at - write.at > WRITE_MS) return []
    if (versions.some((other) => other.at === write.at && (other.session !== write.session || other.removed !== write.removed))) return []
    const producerRoot = this.root(write.session), readerRoot = this.root(success.session)
    if (producerRoot === undefined || readerRoot === undefined) return undefined
    if (producerRoot === null || readerRoot === null || producerRoot !== readerRoot) return []
    return [{
      id: `${success.id}:file:${write.event}`, from: write.session, to: success.session,
      at: success.at, seenAt: now, kind: "file", label: "文件传递",
      summary: `${path}\n由成功写入（${write.event}）→成功读取（${success.id}）按路径关联。`,
      evidence: "session.tool.success",
    }]
  }

  /** Undefined means cache not ready; null means malformed/cyclic ancestry. */
  private root(id: string): string | null | undefined {
    const visited = new Set<string>()
    while (!visited.has(id) && visited.size < 512) {
      visited.add(id)
      const info = this.lookup(id)
      if (!info || info.id !== id) return undefined
      if (!info.parentID) return id
      id = info.parentID
    }
    return null
  }

  private record(path: string, write: Write) {
    const versions = [...(this.files.get(path) ?? []), write]
      .sort((a, b) => b.at - a.at).slice(0, MAX_VERSIONS)
    // Touch the path for bounded FIFO/LRU-like eviction, not an unbounded tree map.
    this.files.delete(path)
    this.files.set(path, versions)
    if (this.files.size > MAX_FILES) this.files.delete(this.files.keys().next().value!)
  }

  private finish(key: string) {
    this.calls.delete(key)
    this.pending.delete(key)
    this.remember(`call:${key}`)
  }

  private remember(key: string) {
    this.seen.add(key)
    if (this.seen.size > MAX_SEEN) this.seen.delete(this.seen.values().next().value!)
  }

  private prune(now: number) {
    for (const [key, success] of this.pending) if (now - success.since > PENDING_MS) this.finish(key)
    for (const [key, call] of this.calls) if (now - call.touched > WRITE_MS) this.finish(key)
    for (const [path, versions] of this.files) {
      const live = versions.filter((write) => now - write.since <= WRITE_MS)
      if (live.length) this.files.set(path, live)
      else this.files.delete(path)
    }
  }
}
