import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import pngToIco from "png-to-ico"

const here = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(here, "..")
const repoRoot = resolve(desktopRoot, "../..")
const source = resolve(repoRoot, "public/logo.png")
const assetsDir = resolve(desktopRoot, "assets")
const icoDestination = resolve(assetsDir, "icon.ico")
const pngDestination = resolve(assetsDir, "icon.png")

await mkdir(dirname(icoDestination), { recursive: true })

const png = await readFile(source)
const ico = await pngToIco(png)
await Promise.all([
  writeFile(icoDestination, ico),
  copyFile(source, pngDestination),
])
