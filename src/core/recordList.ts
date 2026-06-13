// Length-prefixed record framing for the native op boundary: byte payloads
// must be positional Uint8Array args and decryptPreKeySignalOp is at the
// 8-argument ceiling, so a variable number of kyber prekey records travels
// as a single blob. Each record is prefixed with a big-endian u32 length.
// Swift/Kotlin have matching decoders (decodeRecordList in SessionOps).

export function encodeRecordList(records: Uint8Array[]): Uint8Array {
  let total = 0
  for (const r of records) total += 4 + r.length
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  let offset = 0
  for (const r of records) {
    view.setUint32(offset, r.length, false)
    out.set(r, offset + 4)
    offset += 4 + r.length
  }
  return out
}

export function decodeRecordList(blob: Uint8Array): Uint8Array[] {
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength)
  const records: Uint8Array[] = []
  let offset = 0
  while (offset < blob.length) {
    if (offset + 4 > blob.length) throw new Error('recordList: truncated length prefix')
    const len = view.getUint32(offset, false)
    offset += 4
    if (offset + len > blob.length) throw new Error('recordList: truncated record')
    records.push(blob.slice(offset, offset + len))
    offset += len
  }
  return records
}
