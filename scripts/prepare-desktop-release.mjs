/* eslint-disable no-console */

import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

const version = process.argv[2]
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error("Pass the release version as X.Y.Z.")
}
const source =
  "packages/desktop/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis"
const output = "packages/desktop/release"
const installers = (await readdir(source)).filter((name) =>
  name.endsWith(".exe"),
)
if (installers.length !== 1) {
  throw new Error("Expected one Windows installer.")
}
const installer = installers[0]
const signature = (
  await readFile(join(source, `${installer}.sig`), "utf8")
).trim()
if (!signature) throw new Error("The installer has no update signature.")
const fileName = `Alloy-Desktop-${version}-win-x64-setup.exe`
await mkdir(output, { recursive: true })
await copyFile(join(source, installer), join(output, fileName))
await writeFile(join(output, `${fileName}.sig`), `${signature}\n`)
await writeFile(
  join(output, "latest.json"),
  `${JSON.stringify(
    {
      version,
      pub_date: new Date().toISOString(),
      platforms: {
        "windows-x86_64": {
          signature,
          url: `https://github.com/zekurio/alloy/releases/download/v${version}/${fileName}`,
        },
      },
    },
    null,
    2,
  )}\n`,
)
console.log(`Prepared signed desktop release ${version}.`)
