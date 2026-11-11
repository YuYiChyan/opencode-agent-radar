import { defineConfig } from "vite"
import solid from "vite-plugin-solid"

export default defineConfig({ root: "preview", plugins: [solid()], server: { host: "127.0.0.1", port: 4318, strictPort: true, fs: { allow: ["."] } } })
