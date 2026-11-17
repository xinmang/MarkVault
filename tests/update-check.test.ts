import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  isCacheFresh,
  readUpdateCache,
  UPDATE_CHECK_CACHE_KEY,
  UPDATE_CHECK_INTERVAL_MS,
} from '../src/lib/update-check'

describe('compareVersions', () => {
  it('compares numerically per segment', () => {
    expect(compareVersions('1.2.1002', '1.2.1001')).toBeGreaterThan(0)
    expect(compareVersions('1.2.999', '1.2.1001')).toBeLessThan(0)
    expect(compareVersions('0.1.1', '0.1.0')).toBeGreaterThan(0)
    expect(compareVersions('0.1.10', '0.1.9')).toBeGreaterThan(0)
    // 旧版本用过带前导零的构建号（0.0.0001），仍按数值比较，且低于 0.1.0
    expect(compareVersions('0.1.0', '0.0.0001')).toBeGreaterThan(0)
    expect(compareVersions('0.0.0002', '0.0.0001')).toBeGreaterThan(0)
    expect(compareVersions('0.0.0010', '0.0.0009')).toBeGreaterThan(0)
    expect(compareVersions('0.0.10000', '0.0.9999')).toBeGreaterThan(0)
    expect(compareVersions('0.0.0001', '0.0.1')).toBe(0)
    expect(compareVersions('v1.3', '1.2.9999')).toBeGreaterThan(0)
    expect(compareVersions('1.2.0', '1.2')).toBe(0)
  })
})

describe('update cache', () => {
  const store = (value: string | null) => ({
    getItem: (key: string) => (key === UPDATE_CHECK_CACHE_KEY ? value : null),
  })

  it('ignores malformed entries', () => {
    expect(readUpdateCache(store('not json'))).toBeNull()
    expect(readUpdateCache(store('{"latestVersion":1}'))).toBeNull()
  })

  it('expires after the check interval', () => {
    const cache = readUpdateCache(store(JSON.stringify({ latestVersion: '1.0.0', checkedAt: 1000 })))
    expect(isCacheFresh(cache, 1000 + UPDATE_CHECK_INTERVAL_MS - 1)).toBe(true)
    expect(isCacheFresh(cache, 1000 + UPDATE_CHECK_INTERVAL_MS)).toBe(false)
  })
})
