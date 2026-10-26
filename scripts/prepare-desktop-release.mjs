import { readFile, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

// Finishes the desktop release assets electron-builder wrote to
// packages/desktop/release, after the installer has been signed with the
// update key (`<installer>.sig`):
//
// - `latest.yml` gains the signature, which the app checks before it
//   installs an update.
// - `latest.json` offers the same installer to Tauri builds, whose updater
//   reads that file and checks the same signature. Running it replaces the
//   Tauri install with this one.

const version = process.argv[2]
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error("Pass the release version as X.Y.Z.")
}
const output = "packages/desktop/release"
const installer = `Alloy-Desktop-${version}-win-x64-setup.exe`
const files = await readdir(output)
for (const name of [installer, `${installer}.sig`, `${installer}.blockmap`]) {
  if (!files.includes(name)) throw new Error(`Missing ${name} in ${output}.`)
}

const signature = (
  await readFile(join(output, `${installer}.sig`), "utf8")
).trim()
if (!/^[A-Za-z0-9+/=]+$/.test(signature)) {
  throw new Error("The installer has no valid update signature.")
}

const updateInfoPath = join(output, "latest.yml")
const updateInfo = await readFile(updateInfoPath, "utf8")
if (!updateInfo.includes(`version: ${version}\n`)) {
  throw new Error(`latest.yml does not describe version ${version}.`)
}
if (!updateInfo.includes(`path: ${installer}\n`)) {
  throw new Error(`latest.yml does not point at ${installer}.`)
}
await writeFile(
  updateInfoPath,
  `${updateInfo.replace(/^alloySignature: .*\n/m, "").trimEnd()}\nalloySignature: '${signature}'\n`,
)

await writeFile(
  join(output, "latest.json"),
  `${JSON.stringify(
    {
      version,
      pub_date: new Date().toISOString(),
      platforms: {
        "windows-x86_64": {
          signature,
          url: `https://github.com/zekurio/alloy/releases/download/v${version}/${installer}`,
        },
      },
    },
    null,
    2,
  )}\n`,
)
console.log(`Prepared desktop release ${version}.`)
