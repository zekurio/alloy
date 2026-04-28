import { Buffer } from "node:buffer"
import { PassThrough, type Readable } from "node:stream"
import { once } from "node:events"

type ZipEntry = {
  filename: string
  stream: Readable | (() => Readable | null | Promise<Readable | null>)
}

type CentralEntry = {
  filename: string
  crc: number
  size: number
  offset: number
}

const UINT16_MAX = 0xffff
const UINT32_MAX = 0xffffffff

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

function writeUInt64LE(value: number): Buffer {
  const buf = Buffer.allocUnsafe(8)
  buf.writeBigUInt64LE(BigInt(value), 0)
  return buf
}

function zip64ExtraField(values: number[]): Buffer {
  const data = Buffer.concat(values.map(writeUInt64LE))
  const header = Buffer.alloc(4)
  header.writeUInt16LE(0x0001, 0)
  header.writeUInt16LE(data.length, 2)
  return Buffer.concat([header, data])
}

function localHeader(filename: Buffer): Buffer {
  const { date, time } = dosDateTime()
  const buf = Buffer.alloc(30)
  buf.writeUInt32LE(0x04034b50, 0)
  buf.writeUInt16LE(45, 4)
  buf.writeUInt16LE(0x0808, 6)
  buf.writeUInt16LE(0, 8)
  buf.writeUInt16LE(time, 10)
  buf.writeUInt16LE(date, 12)
  buf.writeUInt32LE(UINT32_MAX, 18)
  buf.writeUInt32LE(UINT32_MAX, 22)
  buf.writeUInt16LE(filename.length, 26)
  const extra = zip64ExtraField([0, 0])
  buf.writeUInt16LE(extra.length, 28)
  return Buffer.concat([buf, filename, extra])
}

function dataDescriptor(crc: number, size: number): Buffer {
  return Buffer.concat([
    writeUInt32LE(0x08074b50),
    writeUInt32LE(crc),
    writeUInt64LE(size),
    writeUInt64LE(size),
  ])
}

function centralHeader(entry: CentralEntry): Buffer {
  const filename = Buffer.from(entry.filename, "utf8")
  const extra = zip64ExtraField([entry.size, entry.size, entry.offset])
  const { date, time } = dosDateTime()
  const buf = Buffer.alloc(46)
  buf.writeUInt32LE(0x02014b50, 0)
  buf.writeUInt16LE(45, 4)
  buf.writeUInt16LE(45, 6)
  buf.writeUInt16LE(0x0808, 8)
  buf.writeUInt16LE(0, 10)
  buf.writeUInt16LE(time, 12)
  buf.writeUInt16LE(date, 14)
  buf.writeUInt32LE(entry.crc >>> 0, 16)
  buf.writeUInt32LE(UINT32_MAX, 20)
  buf.writeUInt32LE(UINT32_MAX, 24)
  buf.writeUInt16LE(filename.length, 28)
  buf.writeUInt16LE(extra.length, 30)
  buf.writeUInt32LE(UINT32_MAX, 42)
  return Buffer.concat([buf, filename, extra])
}

function endOfCentralDirectory(count: number, size: number, offset: number) {
  const buf = Buffer.alloc(22)
  buf.writeUInt32LE(0x06054b50, 0)
  buf.writeUInt16LE(Math.min(count, UINT16_MAX), 8)
  buf.writeUInt16LE(Math.min(count, UINT16_MAX), 10)
  buf.writeUInt32LE(Math.min(size, UINT32_MAX), 12)
  buf.writeUInt32LE(Math.min(offset, UINT32_MAX), 16)
  return buf
}

function zip64EndOfCentralDirectory(
  count: number,
  size: number,
  offset: number
): Buffer {
  const buf = Buffer.alloc(56)
  buf.writeUInt32LE(0x06064b50, 0)
  buf.writeBigUInt64LE(44n, 4)
  buf.writeUInt16LE(45, 12)
  buf.writeUInt16LE(45, 14)
  buf.writeBigUInt64LE(BigInt(count), 24)
  buf.writeBigUInt64LE(BigInt(count), 32)
  buf.writeBigUInt64LE(BigInt(size), 40)
  buf.writeBigUInt64LE(BigInt(offset), 48)
  return buf
}

function zip64EndOfCentralDirectoryLocator(offset: number): Buffer {
  const buf = Buffer.alloc(20)
  buf.writeUInt32LE(0x07064b50, 0)
  buf.writeBigUInt64LE(BigInt(offset), 8)
  buf.writeUInt32LE(1, 16)
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

async function openEntryStream(entry: ZipEntry): Promise<Readable | null> {
  return typeof entry.stream === "function" ? entry.stream() : entry.stream
}

export function createZipStream(entries: ZipEntry[]): Readable {
  const out = new PassThrough()

  void (async () => {
    let offset = 0
    const central: CentralEntry[] = []

    for (const [index, entry] of entries.entries()) {
      const stream = await openEntryStream(entry)
      if (!stream) continue

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
      for await (const rawChunk of stream) {
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

    const centralSize = offset - centralOffset
    const zip64EocdOffset = offset
    const zip64Eocd = zip64EndOfCentralDirectory(
      central.length,
      centralSize,
      centralOffset
    )
    await writeChunk(out, zip64Eocd)
    offset += zip64Eocd.length

    const zip64Locator = zip64EndOfCentralDirectoryLocator(zip64EocdOffset)
    await writeChunk(out, zip64Locator)
    offset += zip64Locator.length

    out.end(endOfCentralDirectory(central.length, centralSize, centralOffset))
  })().catch((err) => out.destroy(err))

  return out
}
