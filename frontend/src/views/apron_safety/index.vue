<template>
  <section class="page" data-module="apron_safety">
    <header class="page-head">
      <div>
        <h2>机坪安全管理</h2>
        <p class="page-desc">
          整改归属责任班组：巡查编号、巡查区域、巡查人员、整改措施、安全状态仅责任班组可维护，其他班组只读。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记巡查记录</button>
        <button class="btn" type="button" @click="exportRows">导出机坪安全清单</button>
      </div>
    </header>

    <p class="banner">
      当前班组：{{ session.team }}（负责区域：{{ myRegions.join('、') }}）·
      非本班组责任的记录只读，跨区域提交将被拒绝。可在页面右上角切换班组验证权限。
    </p>
    <p v-if="backfillEntries.length" class="banner warn">
      存量数据受控回填 {{ backfillEntries.length }} 条：
      <span v-for="entry in backfillEntries" :key="entry.id" class="legend-item" :title="entry.依据">
        {{ entry.巡查编号 }}：{{ entry.原区域 }} → {{ entry.回填区域 }}（{{ entry.责任班组 }}）
      </span>
    </p>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <template v-if="column === '责任班组'">
              {{ row['责任班组'] || '未认领' }}
              <span v-if="row['区域来源'] === '受控回填'" class="tag" title="存量缺区域数据，已按规则受控回填">回填</span>
            </template>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <template v-if="isMine(row)">
              <button
                v-for="action in actionsFor(row)"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
              <button class="link" type="button" @click="openEdit(row)">维护整改</button>
              <span v-if="!actionsFor(row).length" class="readonly-hint">已闭环</span>
            </template>
            <template v-else-if="isUnclaimed(row)">
              <button v-if="regionMine(row)" class="link" type="button" @click="claim(row)">受理认领</button>
              <span v-else class="readonly-hint">跨区域只读</span>
            </template>
            <span v-else class="readonly-hint">只读 · 责任班组：{{ row['责任班组'] }}</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无机坪安全数据，可先登记巡查记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条机坪安全记录</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="createVisible" class="modal-mask" @click.self="createVisible = false">
      <div class="modal-card">
        <h3>登记巡查记录（责任班组：{{ session.team }}）</h3>
        <div class="modal-grid">
          <label>
            <span>巡查编号</span>
            <input v-model="createForm.巡查编号" placeholder="如 APRO-0005" />
          </label>
          <label>
            <span>巡查区域（仅本班组负责区域）</span>
            <select v-model="createForm.巡查区域">
              <option v-for="region in myRegions" :key="region" :value="region">{{ region }}</option>
            </select>
          </label>
          <label>
            <span>巡查人员</span>
            <input v-model="createForm.巡查人员" placeholder="巡查人姓名" />
          </label>
          <label>
            <span>巡查日期</span>
            <input v-model="createForm.巡查日期" type="date" />
          </label>
          <label>
            <span>关联航班</span>
            <select v-model="createForm.关联航班">
              <option value="">不关联</option>
              <option v-for="no in flightNumbers" :key="no" :value="no">{{ no }}</option>
            </select>
          </label>
          <label class="span-2">
            <span>发现问题</span>
            <input v-model="createForm.发现问题" placeholder="发现的安全隐患" />
          </label>
        </div>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="createVisible = false">取消</button>
          <button class="btn primary" type="button" @click="submitCreate">提交登记</button>
        </div>
      </div>
    </div>

    <div v-if="editVisible" class="modal-mask" @click.self="editVisible = false">
      <div class="modal-card">
        <h3>维护整改（{{ editTarget?.['巡查编号'] }} · 责任班组：{{ session.team }}）</h3>
        <div class="modal-grid">
          <label>
            <span>巡查编号</span>
            <input v-model="editForm.巡查编号" />
          </label>
          <label>
            <span>巡查区域（仅本班组负责区域）</span>
            <select v-model="editForm.巡查区域">
              <option v-for="region in myRegions" :key="region" :value="region">{{ region }}</option>
            </select>
          </label>
          <label>
            <span>巡查人员</span>
            <input v-model="editForm.巡查人员" />
          </label>
          <label>
            <span>安全状态</span>
            <input v-model="editForm.安全状态" />
          </label>
          <label>
            <span>关联航班</span>
            <select v-model="editForm.关联航班">
              <option value="">不关联</option>
              <option v-for="no in flightNumbers" :key="no" :value="no">{{ no }}</option>
            </select>
          </label>
          <label>
            <span>复查结果</span>
            <input v-model="editForm.复查结果" />
          </label>
          <label class="span-2">
            <span>整改措施</span>
            <textarea v-model="editForm.整改措施" rows="2"></textarea>
          </label>
        </div>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="editVisible = false">取消</button>
          <button class="btn primary" type="button" @click="submitEdit">保存</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  claimIssue,
  createInspection,
  listFlightNumbers,
  readBackfillLog,
  runApronAction,
  updateRectification,
  type BackfillEntry,
  type RectificationPatch,
} from '@/api/apron-safety-service'
import { downloadEntries, listEntries, moduleMeta } from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('apron_safety')
const session = useSessionStore()

const columns = ['巡查编号', '巡查区域', '巡查人员', '巡查日期', '发现问题', '整改措施', '复查结果', '安全状态', '关联航班', '责任班组']
const statuses = ['待巡查', '已巡查', '待整改', '已闭环']
// 各状态下允许发起的流转动作；服务层仍会再校验归属
const ACTION_BY_STATUS: Record<string, string[]> = {
  待巡查: ['记录巡查'],
  已巡查: ['安排整改'],
  待整改: ['确认闭环'],
  已闭环: [],
}

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ['巡查编号', '巡查区域', '巡查人员']
const backfillEntries = ref<BackfillEntry[]>([])
const flightNumbers = ref<string[]>([])

const myRegions = computed(() => session.currentTeam.regions)
const stats = computed(() => [
  { label: '今日巡查', value: rows.value.filter((row) => String(row['巡查日期']) === today()).length },
  { label: '待整改问题', value: rows.value.filter((row) => String(row.status) === '待整改').length },
  { label: '已闭环问题', value: rows.value.filter((row) => String(row.status) === '已闭环').length },
])
const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const createVisible = ref(false)
const createForm = ref({ 巡查编号: '', 巡查区域: '', 巡查人员: '', 巡查日期: '', 发现问题: '', 关联航班: '' })
const editVisible = ref(false)
const editTarget = ref<EntryRow | null>(null)
const editForm = ref({ 巡查编号: '', 巡查区域: '', 巡查人员: '', 整改措施: '', 复查结果: '', 安全状态: '', 关联航班: '' })

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function isMine(row: EntryRow): boolean {
  return String(row['责任班组'] ?? '') === session.team
}

function isUnclaimed(row: EntryRow): boolean {
  return !String(row['责任班组'] ?? '').trim()
}

function regionMine(row: EntryRow): boolean {
  return myRegions.value.includes(String(row['巡查区域'] ?? '').trim())
}

function actionsFor(row: EntryRow): string[] {
  return ACTION_BY_STATUS[String(row.status)] ?? []
}

function applyResult(result: { ok: boolean; message: string }) {
  reload()
  if (result.ok) {
    noticeMessage.value = result.message
  } else {
    errorMessage.value = result.message
  }
}

function claim(row: EntryRow) {
  applyResult(claimIssue(Number(row.id), session.team, session.operator))
}

function runAction(action: string, row: EntryRow) {
  applyResult(runApronAction(Number(row.id), action, session.team))
}

function openCreate() {
  createForm.value = {
    巡查编号: nextCode(),
    巡查区域: myRegions.value[0] ?? '',
    巡查人员: '',
    巡查日期: today(),
    发现问题: '',
    关联航班: '',
  }
  createVisible.value = true
}

function nextCode(): string {
  const max = rows.value.reduce((acc, row) => {
    const matched = /^APRO-(\d+)$/.exec(String(row['巡查编号'] ?? ''))
    return matched ? Math.max(acc, Number(matched[1])) : acc
  }, 0)
  return `APRO-${String(max + 1).padStart(4, '0')}`
}

function submitCreate() {
  createVisible.value = false
  applyResult(createInspection(createForm.value, session.team, session.operator))
}

function openEdit(row: EntryRow) {
  editTarget.value = row
  editForm.value = {
    巡查编号: String(row['巡查编号'] ?? ''),
    巡查区域: String(row['巡查区域'] ?? ''),
    巡查人员: String(row['巡查人员'] ?? ''),
    整改措施: String(row['整改措施'] ?? ''),
    复查结果: String(row['复查结果'] ?? ''),
    安全状态: String(row['安全状态'] ?? ''),
    关联航班: String(row['关联航班'] ?? ''),
  }
  editVisible.value = true
}

function submitEdit() {
  editVisible.value = false
  if (!editTarget.value) {
    return
  }
  const patch: RectificationPatch = { ...editForm.value }
  applyResult(updateRectification(Number(editTarget.value.id), patch, session.team))
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function reload() {
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    flightNumbers.value = listFlightNumbers()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '机坪安全列表读取失败'
  }
}

onMounted(() => {
  backfillEntries.value = readBackfillLog()
  reload()
})
</script>
