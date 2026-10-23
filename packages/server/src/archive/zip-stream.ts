import { crc32 } from "node:zlib"

type ZipEntry = {
  filename: string
  stream:
    | ReadableStream<Uint8Array>
    | (() =>
        | ReadableStream<Uint8Array>
        | null
        | Promise<ReadableStream<Uint8Array> | null>)
}

type CentralEntry = {
  filename: string
  crc: number
  size: number
  offset: number
}

const UINT16_MAX = 0xffff
const UINT32_MAX = 0xffffffff

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear())
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2),
  }
}

function zip64ExtraField(values: number[]): Buffer {
  const buf = Buffer.alloc(4 + values.length * 8)
  buf.writeUInt16LE(0x0001, 0)
  buf.writeUInt16LE(values.length * 8, 2)
  for (const [index, value] of values.entries()) {
    buf.writeBigUInt64LE(BigInt(value), 4 + index * 8)
  }
  return buf
}

function localHeader(filename: Buffer): Buffer {
  const { date, time } = dosDateTime()
  const extra = zip64ExtraField([0, 0])
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
  buf.writeUInt16LE(extra.length, 28)
  return Buffer.concat([buf, filename, extra])
}

function dataDescriptor(crc: number, size: number): Buffer {
  const buf = Buffer.alloc(24)
  buf.writeUInt32LE(0x08074b50, 0)
  buf.writeUInt32LE(crc, 4)
  buf.writeBigUInt64LE(BigInt(size), 8)
  buf.writeBigUInt64LE(BigInt(size), 16)
  return buf
}

function centralHeader(entry: CentralEntry): Buffer {
  const filename = Buffer.from(entry.filename)
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
  buf.writeUInt32LE(entry.crc, 16)
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
  offset: number,
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

async function openEntryStream(
  entry: ZipEntry,
): Promise<ReadableStream<Uint8Array> | null> {
  if ("getReader" in entry.stream) return entry.stream
  return entry.stream()
}

async function* zipChunks(
  entries: ZipEntry[],
): AsyncGenerator<Uint8Array, void, void> {
  let offset = 0
  const central: CentralEntry[] = []

  for (const [index, entry] of entries.entries()) {
    const stream = await openEntryStream(entry)
    if (!stream) continue

    const filename = `${String(index + 1).padStart(3, "0")}-${safeZipFilename(
      entry.filename,
    )}`
    const filenameBytes = Buffer.from(filename)
    const start = offset
    const header = localHeader(filenameBytes)
    offset += header.length
    yield header

    let crc = 0
    let size = 0
    for await (const chunk of stream) {
      crc = crc32(chunk, crc)
      size += chunk.length
      offset += chunk.length
      yield chunk
    }

    const descriptor = dataDescriptor(crc, size)
    offset += descriptor.length
    yield descriptor
    central.push({ filename, crc, size, offset: start })
  }

  const centralOffset = offset
  for (const chunk of central.map(centralHeader)) {
    offset += chunk.length
    yield chunk
  }

  const centralSize = offset - centralOffset
  const zip64EocdOffset = offset
  const zip64Eocd = zip64EndOfCentralDirectory(
    central.length,
    centralSize,
    centralOffset,
  )
  offset += zip64Eocd.length
  yield zip64Eocd

  yield zip64EndOfCentralDirectoryLocator(zip64EocdOffset)
  yield endOfCentralDirectory(central.length, centralSize, centralOffset)
}

export function createZipStream(
  entries: ZipEntry[],
): ReadableStream<Uint8Array> {
  const iterator = zipChunks(entries)
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next()
      if (next.done) {
        controller.close()
        return
      }
      controller.enqueue(next.value)
    },
    async cancel() {
      await iterator.return?.()
    },
  })
}
