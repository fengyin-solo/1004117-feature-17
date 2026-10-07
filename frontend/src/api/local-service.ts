import { checkApronAccess } from '@/data/apron-ownership'
import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'
import { useSessionStore } from '@/stores/session'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 整改完成后要同步放行结论的航班保障字段。
const FLIGHT_RELEASE_FIELD = '放行结论'

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  // 机坪安全：整改归属校验，越权或跨区域提交直接拒绝；未受理问题由先受理班组认领。
  let releaseNote = ''
  if (key === 'apron_safety') {
    const team = useSessionStore().team
    const access = checkApronAccess(rows[index], team)
    if (!access.ok) {
      return { ok: false, message: access.message }
    }
    if (access.claim) {
      updated['责任班组'] = team
      if (access.backfillRegion) {
        updated['巡查区域'] = access.backfillRegion
      }
    }
    if (target === '已闭环') {
      releaseNote = syncFlightRelease(updated)
    }
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」${releaseNote}` }
}

// 机坪安全整改闭环后，同步关联航班在航班保障清单里的放行结论。
function syncFlightRelease(safetyRow: EntryRow): string {
  const flightNo = String(safetyRow['关联航班'] ?? '').trim()
  if (!flightNo) {
    return ''
  }
  const conclusion = `机坪安全已闭环·准予放行（${safetyRow['巡查编号']}）`
  const flights = listRows('flight_ops')
  let touched = 0
  const next = flights.map((row) => {
    if (String(row['航班号'] ?? '').trim() !== flightNo || row[FLIGHT_RELEASE_FIELD] === conclusion) {
      return row
    }
    touched += 1
    return { ...row, [FLIGHT_RELEASE_FIELD]: conclusion }
  })
  if (touched > 0) {
    saveRows('flight_ops', next)
  }
  return touched > 0 ? `，已同步${touched}条航班保障放行结论` : ''
}

// 页面只读化用：当前班组对某条机坪安全记录是否可维护，以及只读原因。
export function apronSafetyPermission(row: EntryRow): { editable: boolean; reason: string } {
  const access = checkApronAccess(row, useSessionStore().team)
  return access.ok ? { editable: true, reason: '' } : { editable: false, reason: access.message }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
