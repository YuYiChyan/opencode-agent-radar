import type { Storage } from "@opencode/plugin/gui/main"
import { safeStorage } from "electron"
import { Buffer } from "node:buffer"
import { platform } from "node:process"
import { Schema } from "effect"
import type { AnalysisSettingsView, SaveAnalysisSettingsInput } from "./services"

const StoredSettings = Schema.Struct({
  mode: Schema.Literals(["off", "host", "custom"]),
  baseURL: Schema.String,
  modelID: Schema.String,
  providerID: Schema.optional(Schema.String),
  encryptedKey: Schema.optional(Schema.String),
  // Bind the retained ciphertext to its destination even while host mode is on.
  keyBaseURL: Schema.optional(Schema.String),
})
type Stored = typeof StoredSettings.Type
// Safe for every OpenCode user: no implicit dependency on any local provider,
// model discovery, credential lookup or paid generation during startup.
const defaults = (): Stored => ({ mode: "off", baseURL: "", modelID: "" })
const Completion = Schema.Struct({
  choices: Schema.Array(Schema.Unknown),
})
const FinalChoice = Schema.Struct({ message: Schema.Struct({ content: Schema.String }) })

/** Only locally authored, non-sensitive messages may use this error class. */
export class AnalyzerConfigError extends Error {}

function normalizeURL(input: string): string {
  const text = input.trim()
  if (!text || text.length > 2_048 || /[\\\s\u0000-\u001f\u007f]/u.test(text)) throw new AnalyzerConfigError("API 地址为空、过长或包含非法字符")
  let url: URL
  try { url = new URL(text) }
  catch { throw new AnalyzerConfigError("API 地址格式错误，需要完整的 https:// 地址") }
  const loopback = url.hostname === "localhost" || url.hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(url.hostname)
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new AnalyzerConfigError("API 地址仅允许 HTTPS，或 localhost / 127.0.0.0/8 / ::1 的 HTTP")
  if (url.username || url.password || text.includes("?") || text.includes("#")) throw new AnalyzerConfigError("API 地址不得包含账号密码、查询参数或片段；Key 请填写到专用输入框")
  // Accept either an API base (/v1) or the full completions endpoint.
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/chat\/completions$/, "")
  return url.href.replace(/\/+$/, "")
}

function modelID(input: string): string {
  const value = input.trim()
  if (!value || value.length > 200 || /[\u0000-\u001f\u007f]/u.test(value)) throw new AnalyzerConfigError("模型 ID 为空、过长或包含控制字符")
  return value
}

function hostProviderID(input: string | undefined): string {
  const value = input?.trim() ?? ""
  if (!value || value.length > 200 || /[\s\u0000-\u001f\u007f]/u.test(value)) throw new AnalyzerConfigError("请填写已配置的宿主 providerID（不能为空、过长或包含空白/控制字符）")
  return value
}

function validKey(input: string): string {
  const key = input.trim()
  if (!key || key.length > 8_192 || !/^[\x21-\x7e]+$/.test(key)) throw new AnalyzerConfigError("API Key 为空、过长或包含不支持的空白/控制字符")
  return key
}

function requireEncryption(): void {
  try {
    if (!safeStorage.isEncryptionAvailable()) throw new Error()
    if (platform === "linux") {
      const backend = safeStorage.getSelectedStorageBackend?.()
      if (!backend || backend === "basic_text" || backend === "unknown") throw new Error()
    }
  } catch {
    throw new AnalyzerConfigError("系统安全存储不可用；不会明文保存 Key，请解锁系统钥匙串、关闭分析或使用已配置的宿主模型")
  }
}

function decrypt(value: Stored): string {
  if (!value.encryptedKey) throw new AnalyzerConfigError("自定义模式需要 API Key；如要删除 Key，请同时关闭分析或切换为宿主模式")
  requireEncryption()
  try {
    if (value.encryptedKey.length > 32_768 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.encryptedKey)) throw new Error()
    return validKey(safeStorage.decryptString(Buffer.from(value.encryptedKey, "base64")))
  } catch {
    throw new AnalyzerConfigError("已保存的 API Key 无法解密；请重新填写 Key 或关闭分析并清除")
  }
}

function publicView(value: Stored, error?: string): AnalysisSettingsView {
  return { mode: value.mode, baseURL: value.baseURL, modelID: value.modelID, ...(value.providerID ? { providerID: value.providerID } : {}), hasKey: !!value.encryptedKey, ...(error ? { error } : {}) }
}

function settingsError(error: unknown): string {
  return error instanceof AnalyzerConfigError ? error.message : "分析设置保存失败；原配置未更改，且未发送 API 请求"
}

async function responseText(response: Response, signal: AbortSignal): Promise<string> {
  // A custom endpoint is untrusted. Cap the envelope before parsing, do not log
  // its body, and cancel the stream on abort even if a mocked transport ignores it.
  const reader = response.body?.getReader()
  if (!reader) throw new AnalyzerConfigError("自定义 API 返回了空响应")
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener("abort", abort, { once: true })
  try {
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      if (signal.aborted) throw new AnalyzerConfigError("分析请求已取消")
      const item = await reader.read()
      if (signal.aborted) throw new AnalyzerConfigError("分析请求已取消")
      if (item.done) break
      size += item.value.byteLength
      if (size > 262_144) {
        void reader.cancel().catch(() => {})
        throw new AnalyzerConfigError("自定义 API 响应超过 256 KiB 限制")
      }
      chunks.push(item.value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return new TextDecoder().decode(bytes)
  } finally {
    signal.removeEventListener("abort", abort)
    reader.releaseLock()
  }
}

/** Call only from Plugin.main. Electron and Node imports are inert in windows. */
export function createAnalyzerConfig(storage: Storage, changed: () => void, preset?: unknown) {
  let initial = defaults()
  // An installation may explicitly opt into an existing host model. Published
  // defaults stay off, and a saved UI choice always overrides this preset.
  if (preset && typeof preset === "object" && "mode" in preset && preset.mode === "host" && "providerID" in preset && "modelID" in preset && typeof preset.providerID === "string" && typeof preset.modelID === "string") {
    try { initial = { mode: "host", baseURL: "", providerID: hostProviderID(preset.providerID), modelID: modelID(preset.modelID) } } catch { /* Invalid optional preset leaves analysis off. */ }
  }
  let current = initial
  let loadError: string | undefined
  let save: ((value: Stored) => void) | undefined
  try {
    const store = storage.store("analysis-settings-v1", { schema: StoredSettings, initial })
    save = (value) => store.set(value)
    const value = store.value
    const keyBaseURL = value.encryptedKey && value.keyBaseURL ? normalizeURL(value.keyBaseURL) : undefined
    // Migrate only an existing, saved v1 host selection. This is not a default
    // or an automatic choice for new installations.
    const legacyKimi = value.mode === "host" && !value.providerID && value.modelID === "kimi-relay/kimi-k3.1-pro"
    current = {
      mode: value.mode,
      baseURL: value.mode === "custom" ? normalizeURL(value.baseURL) : "",
      modelID: value.mode === "off" ? "" : modelID(legacyKimi ? "kimi-k3.1-pro" : value.modelID),
      providerID: value.mode === "host" ? hostProviderID(legacyKimi ? "kimi-relay" : value.providerID) : undefined,
      encryptedKey: value.encryptedKey,
      keyBaseURL,
    }
  } catch {
    current = defaults()
    loadError = "分析设置读取失败；AI 分析保持关闭，请重新保存设置"
  }

  function view(): AnalysisSettingsView {
    let error = loadError
    if (!error && current.mode === "custom") {
      try {
        if (!current.encryptedKey) throw new AnalyzerConfigError("自定义分析器尚未配置 API Key")
        if (current.baseURL !== current.keyBaseURL) throw new AnalyzerConfigError("API Key 与当前地址不匹配，请重新填写 Key")
        requireEncryption()
      } catch (cause) { error = settingsError(cause) }
    }
    // Reading settings never decrypts or returns the secret.
    return publicView(current, error)
  }

  function update(input: SaveAnalysisSettingsInput): AnalysisSettingsView {
    try {
      if (!save) throw new AnalyzerConfigError("分析设置存储不可用；原配置未更改")
      if (input.mode !== "off" && input.mode !== "host" && input.mode !== "custom") throw new AnalyzerConfigError("分析模式无效")
      const freshKey = input.apiKey?.trim() || undefined
      if (freshKey && input.clearKey) throw new AnalyzerConfigError("不能同时填写新 Key 和清除 Key")
      if (freshKey && input.mode !== "custom") throw new AnalyzerConfigError("请先切换自定义模式，再保存新的 API Key")
      const baseURL = input.mode === "custom" ? normalizeURL(input.baseURL) : ""
      const model = input.mode === "off" ? "" : modelID(input.modelID)
      const providerID = input.mode === "host" ? hostProviderID(input.providerID) : undefined
      let encryptedKey = input.clearKey ? undefined : current.encryptedKey
      let keyBaseURL = input.clearKey ? undefined : current.keyBaseURL
      if (input.mode === "custom" && encryptedKey && !freshKey && keyBaseURL !== baseURL) {
        throw new AnalyzerConfigError("API 地址已改变：请同时填写新 Key；或关闭分析并清除旧 Key 后重新配置")
      }
      if (freshKey) {
        const key = validKey(freshKey)
        requireEncryption()
        try { encryptedKey = safeStorage.encryptString(key).toString("base64") }
        catch { throw new AnalyzerConfigError("API Key 加密失败；原配置未更改，不会明文保存") }
        if (!encryptedKey) throw new AnalyzerConfigError("API Key 加密失败；原配置未更改")
        keyBaseURL = baseURL
      }
      const next: Stored = { mode: input.mode, baseURL, modelID: model, providerID, encryptedKey, keyBaseURL }
      if (input.mode === "custom") {
        // Validate a retained key locally; never test the API on save.
        if (!encryptedKey) throw new AnalyzerConfigError("自定义模式需要 API Key；如要删除 Key，请同时关闭分析或切换为宿主模式")
        if (!freshKey) decrypt(next)
      }
      const different = JSON.stringify(current) !== JSON.stringify(next)
      save(next) // One synchronous, schema-backed database write; only ciphertext.
      current = next
      loadError = undefined
      if (different) changed()
      return publicView(current)
    } catch (error) {
      return publicView(current, settingsError(error))
    }
  }

  async function generate(prompt: string, signal: AbortSignal, host: (model: { providerID: string; id: string }) => Promise<string>): Promise<string> {
    const settings = current
    if (signal.aborted) throw new AnalyzerConfigError("分析请求已取消")
    if (settings.mode === "off") throw new AnalyzerConfigError("AI 分析已关闭")
    if (settings.mode === "host") return host({ providerID: hostProviderID(settings.providerID), id: modelID(settings.modelID) })
    const baseURL = normalizeURL(settings.baseURL)
    if (baseURL !== settings.keyBaseURL) throw new AnalyzerConfigError("API Key 与当前地址不匹配，请重新填写 Key")
    const key = decrypt(settings)
    let response: Response
    try {
      response = await fetch(`${baseURL}/chat/completions`, {
        method: "POST", signal, redirect: "error", credentials: "omit", referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: modelID(settings.modelID), stream: false, max_tokens: 1400, messages: [{ role: "user", content: prompt }] }),
      })
    } catch {
      throw new AnalyzerConfigError("自定义 API 请求失败或被取消；请检查地址、连接及 API 权限（不允许重定向）")
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {})
      throw new AnalyzerConfigError(`自定义 API 返回 HTTP ${response.status}；请检查模型、Key 与权限`)
    }
    let text: string
    try {
      const result = Schema.decodeUnknownSync(Completion)(JSON.parse(await responseText(response, signal)))
      text = Schema.decodeUnknownSync(FinalChoice)(result.choices[0]).message.content
    } catch (error) {
      if (error instanceof AnalyzerConfigError) throw error
      throw new AnalyzerConfigError("自定义 API 响应格式错误：需要 choices[0].message.content 最终文本")
    }
    if (!text.trim()) throw new AnalyzerConfigError("自定义 API 未返回最终文本；不会读取 reasoning 字段")
    // Decode escapes before redaction: JSON may echo a key containing quotes,
    // backslashes or Unicode escapes. Only this sanitized structure reaches IPC.
    const fenced = /^\s*```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i.exec(text)
    try {
      return JSON.stringify(JSON.parse(fenced ? fenced[1]! : text, (_name, value: unknown) => typeof value === "string" ? value.split(key).join("[已隐去]") : value))
    } catch {
      // Fail closed, including parser/reviver depth errors. Never let an encoded
      // secret bypass sanitation through a second, less restrictive parser.
      throw new AnalyzerConfigError("自定义分析结果无法安全解析；请重试或更换模型")
    }
  }

  return { view, update, generate, enabled: () => current.mode !== "off" }
}
