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
const textEncoder = new TextEncoder()

const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  CRC_TABLE[n] = c >>> 0
}

function updateCrc(crc: number, chunk: Uint8Array): number {
  let c = crc
  for (const byte of chunk) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
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

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

function bytes(value: string): Uint8Array {
  return textEncoder.encode(value)
}

function u16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true)
}

function u32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true)
}

function u64(view: DataView, offset: number, value: number): void {
  view.setBigUint64(offset, BigInt(value), true)
}

function writeUInt32LE(value: number): Uint8Array {
  const buf = new Uint8Array(4)
  u32(new DataView(buf.buffer), 0, value)
  return buf
}

function writeUInt64LE(value: number): Uint8Array {
  const buf = new Uint8Array(8)
  u64(new DataView(buf.buffer), 0, value)
  return buf
}

function zip64ExtraField(values: number[]): Uint8Array {
  const data = concatBytes(values.map(writeUInt64LE))
  const header = new Uint8Array(4)
  const view = new DataView(header.buffer)
  u16(view, 0, 0x0001)
  u16(view, 2, data.length)
  return concatBytes([header, data])
}

function localHeader(filename: Uint8Array): Uint8Array {
  const { date, time } = dosDateTime()
  const buf = new Uint8Array(30)
  const view = new DataView(buf.buffer)
  u32(view, 0, 0x04034b50)
  u16(view, 4, 45)
  u16(view, 6, 0x0808)
  u16(view, 8, 0)
  u16(view, 10, time)
  u16(view, 12, date)
  u32(view, 18, UINT32_MAX)
  u32(view, 22, UINT32_MAX)
  u16(view, 26, filename.length)
  const extra = zip64ExtraField([0, 0])
  u16(view, 28, extra.length)
  return concatBytes([buf, filename, extra])
}

function dataDescriptor(crc: number, size: number): Uint8Array {
  return concatBytes([
    writeUInt32LE(0x08074b50),
    writeUInt32LE(crc),
    writeUInt64LE(size),
    writeUInt64LE(size),
  ])
}

function centralHeader(entry: CentralEntry): Uint8Array {
  const filename = bytes(entry.filename)
  const extra = zip64ExtraField([entry.size, entry.size, entry.offset])
  const { date, time } = dosDateTime()
  const buf = new Uint8Array(46)
  const view = new DataView(buf.buffer)
  u32(view, 0, 0x02014b50)
  u16(view, 4, 45)
  u16(view, 6, 45)
  u16(view, 8, 0x0808)
  u16(view, 10, 0)
  u16(view, 12, time)
  u16(view, 14, date)
  u32(view, 16, entry.crc)
  u32(view, 20, UINT32_MAX)
  u32(view, 24, UINT32_MAX)
  u16(view, 28, filename.length)
  u16(view, 30, extra.length)
  u32(view, 42, UINT32_MAX)
  return concatBytes([buf, filename, extra])
}

function endOfCentralDirectory(count: number, size: number, offset: number) {
  const buf = new Uint8Array(22)
  const view = new DataView(buf.buffer)
  u32(view, 0, 0x06054b50)
  u16(view, 8, Math.min(count, UINT16_MAX))
  u16(view, 10, Math.min(count, UINT16_MAX))
  u32(view, 12, Math.min(size, UINT32_MAX))
  u32(view, 16, Math.min(offset, UINT32_MAX))
  return buf
}

function zip64EndOfCentralDirectory(
  count: number,
  size: number,
  offset: number
): Uint8Array {
  const buf = new Uint8Array(56)
  const view = new DataView(buf.buffer)
  u32(view, 0, 0x06064b50)
  u64(view, 4, 44)
  u16(view, 12, 45)
  u16(view, 14, 45)
  u64(view, 24, count)
  u64(view, 32, count)
  u64(view, 40, size)
  u64(view, 48, offset)
  return buf
}

function zip64EndOfCentralDirectoryLocator(offset: number): Uint8Array {
  const buf = new Uint8Array(20)
  const view = new DataView(buf.buffer)
  u32(view, 0, 0x07064b50)
  u64(view, 8, offset)
  u32(view, 16, 1)
  return buf
}

function safeZipFilename(filename: string): string {
  return filename.replace(/[/\\?%*:|"<>]+/g, "-") || "clip"
}

async function openEntryStream(
  entry: ZipEntry
): Promise<ReadableStream<Uint8Array> | null> {
  return typeof entry.stream === "function" ? entry.stream() : entry.stream
}

async function* zipChunks(
  entries: ZipEntry[]
): AsyncGenerator<Uint8Array, void, void> {
  let offset = 0
  const central: CentralEntry[] = []

  for (const [index, entry] of entries.entries()) {
    const stream = await openEntryStream(entry)
    if (!stream) continue

    const filename = `${String(index + 1).padStart(3, "0")}-${safeZipFilename(
      entry.filename
    )}`
    const filenameBytes = bytes(filename)
    const start = offset
    const header = localHeader(filenameBytes)
    offset += header.length
    yield header

    let crc = 0xffffffff
    let size = 0
    for await (const chunk of stream) {
      crc = updateCrc(crc, chunk)
      size += chunk.length
      offset += chunk.length
      yield chunk
    }

    const finalCrc = (crc ^ 0xffffffff) >>> 0
    const descriptor = dataDescriptor(finalCrc, size)
    offset += descriptor.length
    yield descriptor
    central.push({ filename, crc: finalCrc, size, offset: start })
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
    centralOffset
  )
  offset += zip64Eocd.length
  yield zip64Eocd

  yield zip64EndOfCentralDirectoryLocator(zip64EocdOffset)
  yield endOfCentralDirectory(central.length, centralSize, centralOffset)
}

export function createZipStream(
  entries: ZipEntry[]
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
