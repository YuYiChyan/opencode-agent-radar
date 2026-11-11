import { createSignal, onCleanup, onMount, Show } from "solid-js"
import type { Context } from "@opencode/plugin/gui"
import { RadarBridge, type AnalysisSettingsView } from "./services"

export function AnalyzerSettings(props: { ctx: Context }) {
  const ui = props.ctx.ui
  const [mode, setMode] = createSignal<"off" | "host" | "custom">("off")
  const [providerID, setProviderID] = createSignal("")
  const [baseURL, setBaseURL] = createSignal("")
  const [modelID, setModelID] = createSignal("")
  const [apiKey, setApiKey] = createSignal("")
  const [hasKey, setHasKey] = createSignal(false)
  const [busy, setBusy] = createSignal(true)
  const [notice, setNotice] = createSignal("")
  let disposed = false
  const apply = (value: AnalysisSettingsView) => {
    setMode(value.mode); setBaseURL(value.baseURL); setModelID(value.modelID); setProviderID(value.providerID ?? ""); setHasKey(value.hasKey)
  }
  onCleanup(() => { disposed = true; setApiKey("") })
  onMount(async () => {
    try { const value = await props.ctx.main(RadarBridge).analysisSettings(); if (!disposed) { apply(value); setNotice(value.error ?? "") } }
    catch { if (!disposed) setNotice("设置读取失败，请重新打开此页。") }
    finally { if (!disposed) setBusy(false) }
  })
  const save = async (clearKey = false) => {
    if (busy()) return
    setBusy(true); setNotice("")
    try {
      const value = await props.ctx.main(RadarBridge).saveAnalysisSettings({ mode: clearKey ? "off" : mode(), baseURL: baseURL().trim(), modelID: modelID().trim(), providerID: providerID().trim(), ...(!clearKey && mode() === "custom" && apiKey().trim() ? { apiKey: apiKey().trim() } : {}), ...(clearKey ? { clearKey: true } : {}) })
      if (!disposed) { if (!value.error) { apply(value); setApiKey("") }; setNotice(value.error || "已保存，将用于下一次逻辑分析。") }
    } catch { if (!disposed) setNotice("保存失败，请检查配置后重试。") }
    finally { if (!disposed) setBusy(false) }
  }
  return <ui.SettingsLayout title="Agent Radar · 分析 API" description="大屏直接运行于 OpenCode 桌面，没有浏览器地址栏。此处配置任务关系分析服务。">
    <ui.SettingsSection title="逻辑关系分析">
      <ui.SettingsRow id="analyzer-mode" title="分析通道" description="监控功能独立运行。可选用已配置的 OpenCode 模型，或兼容 OpenAI Chat Completions 的分析 API。">
        <ui.Select label="分析通道" options={[{ value: "off", label: "关闭 AI 分析" }, { value: "host", label: "OpenCode 已配置模型" }, { value: "custom", label: "自定义 API" }]} value={mode()} onChange={(value) => setMode(value as "off" | "host" | "custom")} disabled={busy()} />
      </ui.SettingsRow>
      <Show when={mode() === "host"}><ui.SettingsRow title="Provider ID" description="填写 OpenCode 中已配置的提供商 ID。"><ui.TextInput label="Provider ID" value={providerID()} onInput={setProviderID} disabled={busy()} /></ui.SettingsRow></Show>
      <Show when={mode() !== "off"}><ui.SettingsRow id="analyzer-model" title="模型 ID"><ui.TextInput label="模型 ID" value={modelID()} onInput={setModelID} placeholder="服务商提供的模型 ID" disabled={busy()} /></ui.SettingsRow></Show>
      <Show when={mode() === "custom"}>
        <ui.SettingsRow id="analyzer-url" title="API 地址" description="填写 API 基础地址，例如 https://api.example.com/v1。"><ui.TextInput label="API 地址" type="url" value={baseURL()} onInput={setBaseURL} placeholder="https://api.example.com/v1" disabled={busy()} /></ui.SettingsRow>
        <ui.SettingsRow id="analyzer-key" title="API Key" description={hasKey() ? "已安全保存。留空保留原 Key；更换地址时请同时填写新 Key。" : "使用系统安全存储加密保存。"}><ui.TextInput label="API Key" type="password" value={apiKey()} onInput={setApiKey} placeholder={hasKey() ? "已保存 · 输入以替换" : "输入 API Key"} disabled={busy()} /></ui.SettingsRow>
      </Show>
      <ui.SettingsRow title="保存配置" description={notice() || "分析仅发送公开任务、调用与结果摘要。"}><div style={{ display: "flex", gap: "12px" }}><ui.Button variant="contrast" disabled={busy()} onClick={() => { void save() }}>保存</ui.Button><Show when={hasKey()}><ui.Button disabled={busy()} onClick={() => { void save(true) }}>删除 Key 并关闭分析</ui.Button></Show></div></ui.SettingsRow>
    </ui.SettingsSection>
  </ui.SettingsLayout>
}
