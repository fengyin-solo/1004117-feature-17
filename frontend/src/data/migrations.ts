import { backfillLegacyRegions, syncAllFlightReleases } from '@/api/apron-safety-service'
import { listRows, saveRows } from './local-store'

// 数据版本化迁移：每次启动时执行，版本号存在 localStorage，已执行过的版本自动跳过。
const VERSION_KEY = 'airport-ground-handling:schema-version'
const CURRENT_VERSION = 2

export function runMigrations(): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  const stored = Number(window.localStorage.getItem(VERSION_KEY) ?? '1')
  if (stored >= CURRENT_VERSION) {
    return
  }
  // v2：机坪安全整改归属管控
  backfillLegacyRegions() // 存量缺区域问题受控回填（含审计日志）
  ensureFlightReleaseField() // 航班保障清单补「放行结论」字段
  syncAllFlightReleases() // 按现有机坪安全问题重算各航班放行结论
  window.localStorage.setItem(VERSION_KEY, String(CURRENT_VERSION))
}

function ensureFlightReleaseField(): void {
  const rows = listRows('flight_ops')
  if (rows.every((row) => row['放行结论'] !== undefined)) {
    return
  }
  saveRows(
    'flight_ops',
    rows.map((row) => (row['放行结论'] === undefined ? { ...row, 放行结论: '正常保障' } : row)),
  )
}
