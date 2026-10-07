import type { EntryRow } from './types'

// 机坪安全整改归属规则：巡查区域划片到班组，责任班组落定后不再随人员调班变化。
export const APRON_REGION_TEAMS: Record<string, string> = {
  东区机坪: '机坪一班',
  西区机坪: '机坪二班',
  货运机坪: '机坪三班',
}

export const APRON_REGIONS: string[] = Object.keys(APRON_REGION_TEAMS)
export const APRON_TEAMS: string[] = [...new Set(Object.values(APRON_REGION_TEAMS))]

export function teamOfRegion(region: string): string {
  return APRON_REGION_TEAMS[region.trim()] ?? ''
}

export function regionsOfTeam(team: string): string[] {
  return APRON_REGIONS.filter((region) => APRON_REGION_TEAMS[region] === team)
}

// 受控回填：缺区域（或区域无效）的存量问题按记录 id 确定性划片，幂等、只补空白、不覆盖有效区域。
export function needsRegionBackfill(row: EntryRow): boolean {
  return teamOfRegion(String(row['巡查区域'] ?? '')) === ''
}

export function backfillRegionFor(id: number): string {
  const index = Math.abs(Math.trunc(id)) % APRON_REGIONS.length
  return APRON_REGIONS[index]
}

export function backfillApronSafetyRows(rows: EntryRow[]): { rows: EntryRow[]; changed: boolean } {
  let changed = false
  const next = rows.map((row) => {
    if (!needsRegionBackfill(row)) {
      return row
    }
    changed = true
    return { ...row, 巡查区域: backfillRegionFor(Number(row.id)) }
  })
  return { rows: changed ? next : rows, changed }
}

export type ApronAccess =
  | { ok: true; claim: boolean; backfillRegion?: string }
  | { ok: false; message: string }

// 整改归属校验：巡查编号、巡查区域、巡查人员、整改措施、安全状态只能由责任班组维护。
// 归属以记录在案的「责任班组」为准，不回查巡查人员的现班组——人员调班后历史整改仍归原班组。
export function checkApronAccess(row: EntryRow, team: string): ApronAccess {
  const owner = String(row['责任班组'] ?? '').trim()
  const region = String(row['巡查区域'] ?? '').trim()
  const regionTeam = teamOfRegion(region)

  if (owner) {
    if (owner !== team) {
      return { ok: false, message: `越权提交被拒绝：该问题责任班组为「${owner}」，「${team}」只读` }
    }
    if (regionTeam && regionTeam !== team) {
      return { ok: false, message: `跨区域提交被拒绝：「${region}」不在「${team}」辖区` }
    }
    return { ok: true, claim: false }
  }

  // 尚未受理：同一问题被两组认领时以先受理者为准，受理即落责任班组。
  if (regionTeam) {
    if (regionTeam !== team) {
      return { ok: false, message: `跨区域提交被拒绝：「${region}」归「${regionTeam}」辖区，「${team}」无权受理` }
    }
    return { ok: true, claim: true }
  }

  // 缺区域的存量问题：受理的同时受控回填到受理班组辖区。
  const fallback = regionsOfTeam(team)[0] ?? backfillRegionFor(Number(row.id))
  return { ok: true, claim: true, backfillRegion: fallback }
}
