import { backfillApronSafetyRows } from './apron-ownership'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'airport-ground-handling:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 存量数据受控回填：机坪安全缺区域的记录按确定性规则补划辖区，只补空白、可重复执行。
function withApronRegionBackfill(data: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  const safety = data['apron_safety']
  if (!safety || safety.length === 0) {
    return data
  }
  const { rows, changed } = backfillApronSafetyRows(safety)
  return changed ? { ...data, apron_safety: rows } : data
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return withApronRegionBackfill(fallback)
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const seeded = withApronRegionBackfill(fallback)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    return seeded
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    const merged = withApronRegionBackfill({ ...fallback, ...parsed })
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
    return merged
  } catch {
    const seeded = withApronRegionBackfill(fallback)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    return seeded
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  // 机坪安全每次落库都过一遍受控回填，保证缺区域的存量问题在任何写路径下都会被补划辖区。
  const safeRows = key === 'apron_safety' ? backfillApronSafetyRows(rows).rows : rows
  const next = { ...allRows(), [key]: safeRows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
