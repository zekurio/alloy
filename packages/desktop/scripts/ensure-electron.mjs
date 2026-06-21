import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

const require = createRequire(import.meta.url)
const electronPackagePath = require.resolve("electron/package.json")
const electronDir = dirname(electronPackagePath)
const electronPackage = JSON.parse(readFileSync(electronPackagePath, "utf8"))
const platformPath = getPlatformPath()
const pathFile = join(electronDir, "path.txt")
const executablePath = join(electronDir, "dist", platformPath)

if (isInstalled()) process.exit(0)

process.stderr.write(
  "Electron binary missing; repairing local Electron install...\n",
)

runElectronInstaller()
if (!isInstalled() && process.platform === "win32") {
  await installWindowsElectronFromCache()
}

if (!isInstalled()) {
  writeWarning(
    `Electron ${electronPackage.version} did not install correctly; ${executablePath} was not found.\n`,
  )
  process.exit(1)
}

function isInstalled() {
  if (!existsSync(executablePath)) return false

  try {
    return readFileSync(pathFile, "utf8") === platformPath
  } catch {
    return false
  }
}

function runElectronInstaller() {
  rmSync(join(electronDir, "dist"), { recursive: true, force: true })
  rmSync(pathFile, { force: true })

  const install = spawnSync(
    process.execPath,
    [join(electronDir, "install.js")],
    {
      stdio: "inherit",
    },
  )
  if (install.error) {
    writeWarning(`Failed to run Electron installer: ${install.error.message}`)
    return
  }
  if (install.status !== 0) {
    writeWarning(`Electron installer exited with ${install.status}`)
  }
}

async function installWindowsElectronFromCache() {
  const electronRequire = createRequire(join(electronDir, "install.js"))
  const electronGet = electronRequire("@electron/get")
  const artifactPath = await electronGet.downloadArtifact({
    version: electronPackage.version,
    artifactName: "electron",
    platform: "win32",
    arch: process.arch,
    checksums: electronRequire("./checksums.json"),
  })

  if (!artifactPath) return

  rmSync(join(electronDir, "dist"), { recursive: true, force: true })
  mkdirSync(join(electronDir, "dist"), { recursive: true })

  const extract = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "& { param($archive, $destination) Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force }",
      artifactPath,
      join(electronDir, "dist"),
    ],
    { stdio: "inherit" },
  )
  if (extract.error) {
    writeWarning(`Failed to extract Electron archive: ${extract.error.message}`)
    return
  }
  if (extract.status !== 0) {
    writeWarning(`Electron archive extraction exited with ${extract.status}`)
    return
  }

  writeFileSync(pathFile, platformPath)
}

function getPlatformPath() {
  switch (process.platform) {
    case "darwin":
      return "Electron.app/Contents/MacOS/Electron"
    case "freebsd":
    case "openbsd":
    case "linux":
      return "electron"
    case "win32":
      return "electron.exe"
    default:
      throw new Error(
        `Electron builds are not available on ${process.platform}`,
      )
  }
}

function writeWarning(message) {
  process.stderr.write(message.endsWith("\n") ? message : `${message}\n`)
}
