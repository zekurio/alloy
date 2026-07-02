import { open } from "node:fs/promises"

export async function moovPrecedesMdat(
  read: (offset: number, length: number) => Promise<Uint8Array>,
  fileSize: number,
): Promise<boolean> {
  let offset = 0
  while (offset < fileSize) {
    const header = await read(offset, 8)
    if (header.byteLength < 8) return false

    const view = new DataView(
      header.buffer,
      header.byteOffset,
      header.byteLength,
    )
    const size = view.getUint32(0)
    const type = String.fromCharCode(
      header[4] ?? 0,
      header[5] ?? 0,
      header[6] ?? 0,
      header[7] ?? 0,
    )
    if (size === 0) {
      if (type === "moov") return true
      return false
    }
    if (size < 8) return false

    if (size !== 1) {
      if (offset + size > fileSize) return false
      if (type === "moov") return true
      if (type === "mdat") return false
      offset += size
      continue
    }

    const largeHeader = await read(offset, 16)
    if (largeHeader.byteLength < 16) return false
    const largeView = new DataView(
      largeHeader.buffer,
      largeHeader.byteOffset,
      largeHeader.byteLength,
    )
    const largeSize = largeView.getBigUint64(8)
    if (largeSize < 16n || largeSize > BigInt(Number.MAX_SAFE_INTEGER))
      return false
    if (offset + Number(largeSize) > fileSize) return false
    if (type === "moov") return true
    if (type === "mdat") return false
    offset += Number(largeSize)
  }

  return false
}

export async function isFastStartFile(path: string): Promise<boolean> {
  const handle = await open(path, "r")
  try {
    const stats = await handle.stat()
    return await moovPrecedesMdat(async (offset, length) => {
      const buffer = new Uint8Array(length)
      const result = await handle.read(buffer, 0, length, offset)
      return buffer.subarray(0, result.bytesRead)
    }, stats.size)
  } finally {
    await handle.close()
  }
}
