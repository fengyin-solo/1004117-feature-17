import { MODULE_BY_KEY } from '@/data/modules'
import { listRows, saveRows } from '@/data/local-store'
import { DUTY_TEAM, isKnownRegion, teamByName, teamOfRegion } from '@/data/teams'
import type { ActionResult, EntryRow } from '@/data/types'

// 机坪安全整改归属管控：巡查编号、巡查区域、巡查人员、整改措施、安全状态等字段
// 只能由责任班组维护，其他班组只读；越权或跨区域提交在本层直接拒绝，页面只做展示控制。
//
// 归属判定一律以记录上快照的「责任班组」为准，不回查人员当前班组：
// 人员调班只影响新认领，历史整改仍归原班组。
const MODULE_KEY = 'apron_safety'
const FLIGHT_KEY = 'flight_ops'
const BACKFILL_LOG_KEY = 'airport-ground-handling:apron-backfill-log'

// 允许责任班组维护的字段（含需求点名的五个受控字段）
const MAINTAINABLE_FIELDS = ['巡查编号', '巡查区域', '巡查人员', '整改措施', '复查结果', '安全状态', '关联航班']

export type RectificationPatch = Partial<Record<(typeof MAINTAINABLE_FIELDS)[number], string>>

export type InspectionInput = {
  巡查编号: string
  巡查区域: string
  巡查人员: string
  巡查日期: string
  发现问题: string
  关联航班: string
}

export type BackfillEntry = {
  id: number
  巡查编号: string
  原区域: string
  回填区域: string
  责任班组: string
  依据: string
  时间: string
}

function meta() {
  const found = MODULE_BY_KEY.get(MODULE_KEY)
  if (!found) {
    throw new Error('没有登记名为 apron_safety 的业务模块')
  }
  return found
}

function findRow(id: number): { rows: EntryRow[]; index: number } | null {
  const rows = listRows(MODULE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  return index < 0 ? null : { rows, index }
}

function ownerOf(row: EntryRow): string {
  return String(row['责任班组'] ?? '').trim()
}

function regionOf(row: EntryRow): string {
  return String(row['巡查区域'] ?? '').trim()
}

function formatTime(value: unknown): string {
  const text = String(value ?? '').trim()
  return text ? text.slice(0, 16).replace('T', ' ') : '未知时间'
}

function rejectCrossRegion(region: string, team: string): ActionResult {
  const owner = teamOfRegion(region)
  const suffix = owner ? `，该区域责任班组为${owner.name}` : '，该区域未纳入任何班组负责范围'
  return { ok: false, message: `跨区域提交已拒绝：「${region}」不属于${team}负责区域${suffix}` }
}

function rejectNotOwner(row: EntryRow, team: string): ActionResult {
  const code = String(row['巡查编号'] ?? row.id)
  return {
    ok: false,
    message: `越权操作已拒绝：「${code}」的整改归属${ownerOf(row)}，${team}对该记录只读`,
  }
}

/** 责任班组认领：同一问题被两组认领时以先受理者为准，后到者直接拒绝。 */
export function claimIssue(id: number, team: string, operator: string): ActionResult {
  const found = findRow(id)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的机坪安全记录` }
  }
  const row = found.rows[found.index]
  const owner = ownerOf(row)
  if (owner && owner !== team) {
    return {
      ok: false,
      message: `认领已拒绝：该问题已由${owner}于${formatTime(row['认领时间'])}受理，同一问题以先受理者为准`,
    }
  }
  if (owner === team) {
    return { ok: false, message: `该问题已由${team}受理，无需重复认领` }
  }
  const region = regionOf(row)
  if (!teamByName(team)?.regions.includes(region)) {
    return rejectCrossRegion(region, team)
  }
  const updated: EntryRow = {
    ...row,
    责任班组: team,
    认领人: operator,
    认领时间: new Date().toISOString(),
    区域来源: row['区域来源'] || '巡查登记',
  }
  const next = [...found.rows]
  next[found.index] = updated
  saveRows(MODULE_KEY, next)
  return { ok: true, message: `${team}已受理「${String(row['巡查编号'])}」，整改归属本班组` }
}

/** 登记新巡查记录：登记班组即责任班组，区域必须在本班组负责范围内。 */
export function createInspection(input: InspectionInput, team: string, operator: string): ActionResult {
  const code = input.巡查编号.trim()
  const region = input.巡查区域.trim()
  if (!code) {
    return { ok: false, message: '巡查编号不能为空' }
  }
  if (!teamByName(team)?.regions.includes(region)) {
    return rejectCrossRegion(region, team)
  }
  const rows = listRows(MODULE_KEY)
  if (rows.some((row) => String(row['巡查编号']).trim() === code)) {
    return { ok: false, message: `巡查编号「${code}」已存在，不能重复登记` }
  }
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const row: EntryRow = {
    id,
    status: meta().statuses[0],
    pending: true,
    abnormal: false,
    巡查编号: code,
    巡查区域: region,
    巡查人员: input.巡查人员.trim(),
    巡查日期: input.巡查日期,
    发现问题: input.发现问题.trim(),
    整改措施: '',
    复查结果: '',
    安全状态: '待评估',
    关联航班: input.关联航班.trim(),
    责任班组: team,
    认领人: operator,
    认领时间: new Date().toISOString(),
    区域来源: '巡查登记',
  }
  saveRows(MODULE_KEY, [...rows, row])
  const sync = syncFlightRelease(row['关联航班'] as string)
  const suffix = sync ? `；已同步航班${row['关联航班']}放行结论：「${sync}」` : ''
  return { ok: true, message: `已登记「${code}」，责任班组${team}${suffix}` }
}

/** 维护受控字段：仅责任班组可改；改区域时新区域也必须在本班组负责范围内。 */
export function updateRectification(id: number, patch: RectificationPatch, team: string): ActionResult {
  const found = findRow(id)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的机坪安全记录` }
  }
  const row = found.rows[found.index]
  if (ownerOf(row) !== team) {
    return rejectNotOwner(row, team)
  }
  const cleaned: Record<string, string> = {}
  for (const field of MAINTAINABLE_FIELDS) {
    const value = patch[field as keyof RectificationPatch]
    if (value !== undefined) {
      cleaned[field] = value.trim()
    }
  }
  if (cleaned['巡查区域'] !== undefined && !teamByName(team)?.regions.includes(cleaned['巡查区域'])) {
    return rejectCrossRegion(cleaned['巡查区域'], team)
  }
  if (cleaned['巡查编号'] !== undefined) {
    if (!cleaned['巡查编号']) {
      return { ok: false, message: '巡查编号不能为空' }
    }
    const duplicated = found.rows.some(
      (item) => Number(item.id) !== id && String(item['巡查编号']).trim() === cleaned['巡查编号'],
    )
    if (duplicated) {
      return { ok: false, message: `巡查编号「${cleaned['巡查编号']}」已被其他记录使用` }
    }
  }
  const updated: EntryRow = { ...row, ...cleaned }
  const next = [...found.rows]
  next[found.index] = updated
  saveRows(MODULE_KEY, next)
  // 关联航班变化时，新旧两个航班的放行结论都要重算
  const before = String(row['关联航班'] ?? '').trim()
  const after = String(updated['关联航班'] ?? '').trim()
  const touched = new Set([before, after])
  const conclusions: string[] = []
  for (const flightNo of touched) {
    const conclusion = syncFlightRelease(flightNo)
    if (conclusion) {
      conclusions.push(`航班${flightNo}放行结论：「${conclusion}」`)
    }
  }
  const suffix = conclusions.length ? `；已同步${conclusions.join('，')}` : ''
  return { ok: true, message: `「${String(updated['巡查编号'])}」整改信息已更新${suffix}` }
}

/** 状态流转（记录巡查/安排整改/确认闭环）：仅责任班组可执行，闭环后同步航班放行结论。 */
export function runApronAction(id: number, action: string, team: string): ActionResult {
  const moduleMeta = meta()
  const target = moduleMeta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `机坪安全没有登记「${action}」这个动作` }
  }
  const found = findRow(id)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的机坪安全记录` }
  }
  const row = found.rows[found.index]
  const owner = ownerOf(row)
  if (!owner) {
    return { ok: false, message: `该问题尚未受理，需先由负责「${regionOf(row)}」的班组认领` }
  }
  if (owner !== team) {
    return rejectNotOwner(row, team)
  }
  const current = String(row.status)
  if (current === target) {
    return { ok: false, message: `该记录已经是「${target}」，不用重复操作` }
  }
  const lastStatus = moduleMeta.statuses[moduleMeta.statuses.length - 1]
  const updated: EntryRow = {
    ...row,
    status: target,
    pending: target !== lastStatus,
    // 安排整改说明隐患确认存在，看板标异常；确认闭环后异常解除
    abnormal: action === '安排整改' ? true : action === '确认闭环' ? false : Boolean(row.abnormal),
  }
  const next = [...found.rows]
  next[found.index] = updated
  saveRows(MODULE_KEY, next)
  const flightNo = String(updated['关联航班'] ?? '').trim()
  const conclusion = syncFlightRelease(flightNo)
  const suffix = conclusion ? `；已同步航班${flightNo}放行结论：「${conclusion}」` : ''
  return { ok: true, message: `「${String(row['巡查编号'])}」已${action}，当前状态「${target}」${suffix}` }
}

/**
 * 按机坪安全问题重算航班放行结论：存在未闭环隐患则暂缓放行，全部闭环则安全放行。
 * 整改完成（确认闭环）后由本函数把结论同步到航班保障清单。
 */
export function syncFlightRelease(flightNo: string): string | null {
  const code = flightNo.trim()
  if (!code) {
    return null
  }
  const issues = listRows(MODULE_KEY).filter((row) => String(row['关联航班'] ?? '').trim() === code)
  const flights = listRows(FLIGHT_KEY)
  const matched = flights.some((row) => String(row['航班号'] ?? '').trim() === code)
  if (!issues.length || !matched) {
    return null
  }
  const open = issues.filter((row) => String(row.status) !== '已闭环')
  const conclusion = open.length
    ? `暂缓放行：${open.length}项机坪安全隐患未闭环`
    : '安全放行：机坪安全隐患已闭环'
  let changed = false
  const next = flights.map((row) => {
    if (String(row['航班号'] ?? '').trim() !== code || row['放行结论'] === conclusion) {
      return row
    }
    changed = true
    return { ...row, 放行结论: conclusion }
  })
  if (changed) {
    saveRows(FLIGHT_KEY, next)
  }
  return conclusion
}

export function syncAllFlightReleases(): void {
  const flightNos = new Set(
    listRows(MODULE_KEY).map((row) => String(row['关联航班'] ?? '').trim()).filter(Boolean),
  )
  for (const flightNo of flightNos) {
    syncFlightRelease(flightNo)
  }
}

/**
 * 存量缺区域问题受控回填（迁移用，幂等：区域已合法的记录不再触碰）：
 * 1. 优先按巡查人员在地勤排班里的所属班组，回填该班组主区域；
 * 2. 人员查不到班组的，兜底回填到值班班组主区域；
 * 3. 回填同时把责任班组快照到记录上（此后人员调班不影响归属），
 *    并标记「区域来源=受控回填」、写审计日志，全过程可追溯。
 */
export function backfillLegacyRegions(now: Date = new Date()): BackfillEntry[] {
  const rows = listRows(MODULE_KEY)
  const crew = listRows('crew_schedule')
  const entries: BackfillEntry[] = []
  const next = rows.map((row) => {
    const region = regionOf(row)
    if (isKnownRegion(region)) {
      return row
    }
    const inspector = String(row['巡查人员'] ?? '').trim()
    const crewRow = crew.find((item) => String(item['姓名'] ?? '').trim() === inspector)
    const crewTeam = crewRow ? teamByName(String(crewRow['所属班组'] ?? '')) : undefined
    const team = crewTeam ?? DUTY_TEAM
    const targetRegion = team.regions[0]
    const basis = crewTeam
      ? `巡查人员${inspector || '（空）'}属${crewTeam.name}，按班组主区域回填`
      : `巡查人员未匹配到班组，兜底回填至值班班组${DUTY_TEAM.name}主区域`
    entries.push({
      id: Number(row.id),
      巡查编号: String(row['巡查编号'] ?? ''),
      原区域: region || '（空）',
      回填区域: targetRegion,
      责任班组: team.name,
      依据: basis,
      时间: now.toISOString(),
    })
    return {
      ...row,
      巡查区域: targetRegion,
      责任班组: ownerOf(row) ? ownerOf(row) : team.name,
      认领人: String(row['认领人'] ?? '').trim() || '系统回填',
      认领时间: String(row['认领时间'] ?? '').trim() || now.toISOString(),
      区域来源: '受控回填',
    }
  })
  if (entries.length) {
    saveRows(MODULE_KEY, next)
    appendBackfillLog(entries)
  }
  return entries
}

function appendBackfillLog(entries: BackfillEntry[]): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  window.localStorage.setItem(BACKFILL_LOG_KEY, JSON.stringify([...readBackfillLog(), ...entries]))
}

export function readBackfillLog(): BackfillEntry[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  try {
    return JSON.parse(window.localStorage.getItem(BACKFILL_LOG_KEY) ?? '[]') as BackfillEntry[]
  } catch {
    return []
  }
}

/** 航班保障清单里的航班号，供登记/维护时选择关联航班。 */
export function listFlightNumbers(): string[] {
  return listRows(FLIGHT_KEY).map((row) => String(row['航班号'] ?? '')).filter(Boolean)
}
