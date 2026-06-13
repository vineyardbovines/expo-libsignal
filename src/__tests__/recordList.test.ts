import { decodeRecordList, encodeRecordList } from '../core/recordList'

describe('encodeRecordList / decodeRecordList', () => {
  test('round-trips an empty list', () => {
    expect(encodeRecordList([])).toEqual(new Uint8Array(0))
    expect(decodeRecordList(new Uint8Array(0))).toEqual([])
  })

  test('encodes a single record with a big-endian u32 length prefix', () => {
    const r = new Uint8Array([1, 2, 3])
    const blob = encodeRecordList([r])
    expect(blob).toEqual(new Uint8Array([0, 0, 0, 3, 1, 2, 3]))
    expect(decodeRecordList(blob)).toEqual([r])
  })

  test('round-trips multiple records including an empty one', () => {
    const records = [new Uint8Array([9]), new Uint8Array(0), new Uint8Array([7, 8])]
    expect(decodeRecordList(encodeRecordList(records))).toEqual(records)
  })

  test('decode throws on truncated input', () => {
    expect(() => decodeRecordList(new Uint8Array([0, 0]))).toThrow('truncated')
    expect(() => decodeRecordList(new Uint8Array([0, 0, 0, 5, 1]))).toThrow('truncated')
  })
})
