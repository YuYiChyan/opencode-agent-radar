// The plugin SDK references Electron but does not ship its types. Keep this
// declaration limited to the main-process API used here; no Electron dependency
// is bundled or installed by the plugin.
// This workspace also omits @types/node. These two narrow Node declarations are
// sufficient for the safeStorage boundary; the host supplies the real modules.
declare module "node:buffer" {
  export interface Buffer extends Uint8Array {
    toString(encoding?: "base64"): string
  }
  export const Buffer: {
    from(value: string, encoding: "base64"): Buffer
  }
}
declare module "node:process" {
  export const platform: string
}
declare module "electron" {
  export const safeStorage: {
    isEncryptionAvailable(): boolean
    encryptString(plainText: string): import("node:buffer").Buffer
    decryptString(encrypted: import("node:buffer").Buffer): string
    getSelectedStorageBackend?(): string
  }
}
