import { Buffer } from "node:buffer"
import { PassThrough, type Readable } from "node:stream"
import { once } from "node:events"

type ZipEntry = {
  filename: string
  stream: Readable
}

type CentralEntry = {
  filename: string
  crc: number
  size: number
  offset: number
}

const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  CRC_TABLE[n] = c >>> 0
}

function updateCrc(crc: number, chunk: Buffer): number {
  let c = crc
  for (const byte of chunk) {
    c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  }
  return c
}

function dosDateTime(date = new Date()): { date: number; time: number } {
  const year = Math.max(1980, date.getFullYear())
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2),
  }
}

function writeUInt32LE(value: number): Buffer {
  const buf = Buffer.allocUnsafe(4)
  buf.writeUInt32LE(value >>> 0, 0)
  return buf
}

function localHeader(filename: Buffer): Buffer {
  const { date, time } = dosDateTime()
  const buf = Buffer.alloc(30)
  buf.writeUInt32LE(0x04034b50, 0)
  buf.writeUInt16LE(20, 4)
  buf.writeUInt16LE(0x0808, 6)
  buf.writeUInt16LE(0, 8)
  buf.writeUInt16LE(time, 10)
  buf.writeUInt16LE(date, 12)
  buf.writeUInt16LE(filename.length, 26)
  return Buffer.concat([buf, filename])
}

function dataDescriptor(crc: number, size: number): Buffer {
  return Buffer.concat([
    writeUInt32LE(0x08074b50),
    writeUInt32LE(crc),
    writeUInt32LE(size),
    writeUInt32LE(size),
  ])
}

function centralHeader(entry: CentralEntry): Buffer {
  const filename = Buffer.from(entry.filename, "utf8")
  const { date, time } = dosDateTime()
  const buf = Buffer.alloc(46)
  buf.writeUInt32LE(0x02014b50, 0)
  buf.writeUInt16LE(20, 4)
  buf.writeUInt16LE(20, 6)
  buf.writeUInt16LE(0x0808, 8)
  buf.writeUInt16LE(0, 10)
  buf.writeUInt16LE(time, 12)
  buf.writeUInt16LE(date, 14)
  buf.writeUInt32LE(entry.crc >>> 0, 16)
  buf.writeUInt32LE(entry.size, 20)
  buf.writeUInt32LE(entry.size, 24)
  buf.writeUInt16LE(filename.length, 28)
  buf.writeUInt32LE(entry.offset, 42)
  return Buffer.concat([buf, filename])
}

function endOfCentralDirectory(count: number, size: number, offset: number) {
  const buf = Buffer.alloc(22)
  buf.writeUInt32LE(0x06054b50, 0)
  buf.writeUInt16LE(count, 8)
  buf.writeUInt16LE(count, 10)
  buf.writeUInt32LE(size, 12)
  buf.writeUInt32LE(offset, 16)
  return buf
}

function safeZipFilename(filename: string): string {
  return filename.replace(/[/\\?%*:|"<>]+/g, "-") || "clip"
}

async function writeChunk(out: PassThrough, chunk: Buffer): Promise<void> {
  if (!out.write(chunk)) {
    await once(out, "drain")
  }
}

export function createZipStream(entries: ZipEntry[]): Readable {
  const out = new PassThrough()

  void (async () => {
    let offset = 0
    const central: CentralEntry[] = []

    for (const [index, entry] of entries.entries()) {
      const filename = Buffer.from(
        `${String(index + 1).padStart(3, "0")}-${safeZipFilename(entry.filename)}`,
        "utf8"
      )
      const start = offset
      const header = localHeader(filename)
      await writeChunk(out, header)
      offset += header.length

      let crc = 0xffffffff
      let size = 0
      for await (const rawChunk of entry.stream) {
        const chunk = Buffer.isBuffer(rawChunk)
          ? rawChunk
          : Buffer.from(rawChunk as Uint8Array)
        crc = updateCrc(crc, chunk)
        size += chunk.length
        offset += chunk.length
        await writeChunk(out, chunk)
      }

      const finalCrc = (crc ^ 0xffffffff) >>> 0
      const descriptor = dataDescriptor(finalCrc, size)
      await writeChunk(out, descriptor)
      offset += descriptor.length
      central.push({
        filename: filename.toString("utf8"),
        crc: finalCrc,
        size,
        offset: start,
      })
    }

    const centralOffset = offset
    const centralBuffers = central.map(centralHeader)
    for (const buf of centralBuffers) {
      await writeChunk(out, buf)
      offset += buf.length
    }

    out.end(
      endOfCentralDirectory(
        central.length,
        offset - centralOffset,
        centralOffset
      )
    )
  })().catch((err) => out.destroy(err))

  return out
}
