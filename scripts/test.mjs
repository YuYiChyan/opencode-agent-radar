import { build } from "esbuild"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
const temp = await mkdtemp(join(tmpdir(), "agent-radar-tests-"))
try {
  const files = (await readdir(resolve(root, "tests"))).filter((name) => name.endsWith(".test.ts")).sort()
  if (!files.length) throw new Error("No test suites found")
  for (const name of files) {
    console.log(`\n${name}`)
    const outfile = join(temp, name.replace(/\.ts$/, ".mjs"))
    await build({ entryPoints: [resolve(root, "tests", name)], outfile, bundle: true, platform: "node", format: "esm", logLevel: "warning" })
    const result = spawnSync(process.execPath, [outfile], { cwd: root, stdio: "inherit" })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`${name} failed (${result.signal ?? result.status})`)
  }
  console.log(`\nPASS: ${files.length} test suites`)
} finally {
  await rm(temp, { recursive: true, force: true })
}
