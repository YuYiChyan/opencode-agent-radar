import { Ipc } from "@opencode/plugin/gui"
import { Schema } from "effect"

const QuotaRow = Schema.Struct({
  key: Schema.mutableKey(Schema.String),
  label: Schema.mutableKey(Schema.String),
  value: Schema.mutableKey(Schema.String),
  percent: Schema.mutableKey(Schema.optional(Schema.Finite)),
  resetAt: Schema.mutableKey(Schema.optional(Schema.String)),
  checkedAt: Schema.mutableKey(Schema.optional(Schema.Finite)),
  status: Schema.mutableKey(Schema.optional(Schema.String)),
  providerID: Schema.mutableKey(Schema.optional(Schema.String)),
  group: Schema.mutableKey(Schema.optional(Schema.String)),
  valueType: Schema.mutableKey(Schema.optional(Schema.Literals(["percent", "amount"]))),
})

const Quota = Schema.Struct({
  updatedAt: Schema.mutableKey(Schema.Finite),
  state: Schema.mutableKey(Schema.Literals(["ready", "error"])),
  error: Schema.mutableKey(Schema.optional(Schema.String)),
  rows: Schema.mutableKey(Schema.mutable(Schema.Array(QuotaRow))),
})

const AnalysisEdge = Schema.Struct({
  from: Schema.mutableKey(Schema.String),
  to: Schema.mutableKey(Schema.String),
  label: Schema.mutableKey(Schema.String),
  inferred: Schema.mutableKey(Schema.Boolean),
})

const Analysis = Schema.Struct({
  enabled: Schema.mutableKey(Schema.optional(Schema.Boolean)),
  coveredIDs: Schema.mutableKey(Schema.optional(Schema.mutable(Schema.Array(Schema.String)))),
  state: Schema.mutableKey(Schema.Literals(["idle", "running", "ready", "error"])),
  updatedAt: Schema.mutableKey(Schema.Finite),
  summary: Schema.mutableKey(Schema.String),
  edges: Schema.mutableKey(Schema.mutable(Schema.Array(AnalysisEdge))),
  error: Schema.mutableKey(Schema.optional(Schema.String)),
})

export type QuotaView = typeof Quota.Type
export type AnalysisView = typeof Analysis.Type
export type AnalysisInput = { rootKey: string; signature: string; payload: string }

const AnalysisSettings = Schema.Struct({
  mode: Schema.mutableKey(Schema.Literals(["off", "host", "custom"])),
  baseURL: Schema.mutableKey(Schema.String),
  modelID: Schema.mutableKey(Schema.String),
  providerID: Schema.mutableKey(Schema.optional(Schema.String)),
  hasKey: Schema.mutableKey(Schema.Boolean),
  error: Schema.mutableKey(Schema.optional(Schema.String)),
})
const SaveAnalysisSettings = Schema.Struct({
  mode: Schema.Literals(["off", "host", "custom"]),
  baseURL: Schema.String,
  modelID: Schema.String,
  providerID: Schema.optional(Schema.String),
  apiKey: Schema.optional(Schema.String),
  clearKey: Schema.optional(Schema.Boolean),
})
export type AnalysisSettingsView = typeof AnalysisSettings.Type
export type SaveAnalysisSettingsInput = typeof SaveAnalysisSettings.Type

/** The GUI package's id must be `agent-radar` (or its server part must use that id). */
export const RadarBridge = Ipc.define({
  id: "agent-radar.bridge",
  methods: {
    analysisSettings: { output: AnalysisSettings },
    saveAnalysisSettings: { input: SaveAnalysisSettings, output: AnalysisSettings },
    quota: { output: Quota },
    analyze: {
      input: Schema.Struct({ rootKey: Schema.String, signature: Schema.String, payload: Schema.String }),
      output: Analysis,
    },
  },
})
