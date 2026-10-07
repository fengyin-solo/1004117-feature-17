// 冒烟测试：验证机坪安全整改归属管控的核心规则（node + localStorage shim 运行）
const store = new Map<string, string>()
;(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  },
}

import {
  claimIssue,
  createInspection,
  readBackfillLog,
  runApronAction,
  updateRectification,
} from '@/api/apron-safety-service'
import { runAction } from '@/api/local-service'
import { listRows, saveRows } from '@/data/local-store'
import { runMigrations } from '@/data/migrations'

let passed = 0
let failed = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name} ${detail}`)
  }
}

runMigrations()

console.log('1. 存量缺区域受控回填')
const log = readBackfillLog()
const row3 = listRows('apron_safety').find((r) => r['巡查编号'] === 'APRO-0003')!
check('缺区域存量问题被回填', row3['巡查区域'] === 'T2机坪', `实际=${row3['巡查区域']}`)
check('回填到巡查人员所属班组', row3['责任班组'] === '机坪安全三班')
check('回填标记与认领人', row3['区域来源'] === '受控回填' && row3['认领人'] === '系统回填')
check('审计日志留痕', log.length === 1 && log[0]['巡查编号'] === 'APRO-0003' && log[0]['原区域'] === '（空）')

console.log('2. 迁移后放行结论初始化')
const flights = listRows('flight_ops')
const ca = flights.find((r) => r['航班号'] === 'CA1234')!
const mu = flights.find((r) => r['航班号'] === 'MU5678')!
const cz = flights.find((r) => r['航班号'] === 'CZ9876')!
check('CA1234 有未闭环隐患→暂缓放行', ca['放行结论'] === '暂缓放行：1项机坪安全隐患未闭环', String(ca['放行结论']))
check('MU5678 存量问题未闭环→暂缓放行', mu['放行结论'] === '暂缓放行：1项机坪安全隐患未闭环')
check('CZ9876 无关联隐患→正常保障', cz['放行结论'] === '正常保障')

console.log('3. 认领：先受理者为准 + 跨区域拒绝')
const crossClaim = claimIssue(4, '机坪安全二班', '李强')
check('二班认领东区问题→跨区域拒绝', !crossClaim.ok && crossClaim.message.includes('跨区域'), crossClaim.message)
const firstClaim = claimIssue(4, '机坪安全一班', '张伟')
check('一班认领本区问题→受理成功', firstClaim.ok, firstClaim.message)
const secondClaim = claimIssue(4, '机坪安全三班', '王磊')
check('三班再认领→先受理者优先', !secondClaim.ok && secondClaim.message.includes('先受理者'), secondClaim.message)

console.log('4. 越权维护直接拒绝')
const wrongTeamAction = runApronAction(2, '确认闭环', '机坪安全一班')
check('一班闭环二班问题→越权拒绝', !wrongTeamAction.ok && wrongTeamAction.message.includes('越权'), wrongTeamAction.message)
const wrongTeamEdit = updateRectification(2, { 整改措施: '越权修改' }, '机坪安全一班')
check('一班改二班整改措施→越权拒绝', !wrongTeamEdit.ok, wrongTeamEdit.message)
const crossRegionEdit = updateRectification(2, { 巡查区域: 'T2机坪' }, '机坪安全二班')
check('二班把问题改到T2机坪→跨区域拒绝', !crossRegionEdit.ok && crossRegionEdit.message.includes('跨区域'), crossRegionEdit.message)
const genericGuard = runAction('apron_safety', 2, '确认闭环')
check('通用runAction入口→直接拒绝', !genericGuard.ok, genericGuard.message)

console.log('5. 责任班组闭环后同步航班放行结论')
const okEdit = updateRectification(2, { 整改措施: '已清移托盘并复查合格', 复查结果: '复查合格', 安全状态: '隐患已消除' }, '机坪安全二班')
check('二班维护本组整改→成功', okEdit.ok, okEdit.message)
const close = runApronAction(2, '确认闭环', '机坪安全二班')
check('二班确认闭环→成功且提示同步', close.ok && close.message.includes('安全放行'), close.message)
const caAfter = listRows('flight_ops').find((r) => r['航班号'] === 'CA1234')!
check('CA1234 全部闭环→安全放行', caAfter['放行结论'] === '安全放行：机坪安全隐患已闭环', String(caAfter['放行结论']))

console.log('6. 人员调班后历史整改仍归原班组')
const crew = listRows('crew_schedule').map((r) => (r['姓名'] === '王磊' ? { ...r, 所属班组: '机坪安全一班' } : r))
saveRows('crew_schedule', crew)
const row3After = listRows('apron_safety').find((r) => r['巡查编号'] === 'APRO-0003')!
check('王磊调到一班后APRO-0003仍归三班', row3After['责任班组'] === '机坪安全三班')
const transferAction = runApronAction(3, '安排整改', '机坪安全一班')
check('一班对原三班问题操作→越权拒绝', !transferAction.ok && transferAction.message.includes('越权'), transferAction.message)
const ownerAction = runApronAction(3, '安排整改', '机坪安全三班')
check('三班对本组问题安排整改→成功', ownerAction.ok, ownerAction.message)

console.log('7. 登记新记录的区域管控')
const badCreate = createInspection(
  { 巡查编号: 'APRO-0005', 巡查区域: 'T2机坪', 巡查人员: '张伟', 巡查日期: '2026-10-07', 发现问题: '跨区域测试', 关联航班: '' },
  '机坪安全一班',
  '张伟',
)
check('一班在T2机坪登记→跨区域拒绝', !badCreate.ok && badCreate.message.includes('跨区域'), badCreate.message)
const goodCreate = createInspection(
  { 巡查编号: 'APRO-0005', 巡查区域: 'T1机坪西区', 巡查人员: '张伟', 巡查日期: '2026-10-07', 发现问题: '西区测试', 关联航班: 'MU5678' },
  '机坪安全一班',
  '张伟',
)
check('一班在本区登记→成功', goodCreate.ok, goodCreate.message)
const muAfter = listRows('flight_ops').find((r) => r['航班号'] === 'MU5678')!
check('新隐患登记后MU5678暂缓放行升级', muAfter['放行结论'] === '暂缓放行：2项机坪安全隐患未闭环', String(muAfter['放行结论']))
const dupCreate = createInspection(
  { 巡查编号: 'APRO-0005', 巡查区域: 'T1机坪西区', 巡查人员: '张伟', 巡查日期: '2026-10-07', 发现问题: '重复编号', 关联航班: '' },
  '机坪安全一班',
  '张伟',
)
check('重复巡查编号→拒绝', !dupCreate.ok && dupCreate.message.includes('已存在'), dupCreate.message)

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) {
  process.exit(1)
}
