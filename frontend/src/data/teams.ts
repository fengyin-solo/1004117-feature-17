// 机坪安全班组与巡查区域的归属配置：整改归属权限、跨区域拦截、存量回填都以此为准。
// 责任班组对归属区域外的记录只有只读权限，跨区域提交在服务层直接拒绝。
export type SafetyTeam = {
  name: string
  regions: string[]
  /** 值班班组：无法推断归属的存量问题兜底回填到它的主区域 */
  duty?: boolean
}

export const SAFETY_TEAMS: SafetyTeam[] = [
  { name: '机坪安全一班', regions: ['T1机坪东区', 'T1机坪西区'], duty: true },
  { name: '机坪安全二班', regions: ['货运机坪', '远机位区'] },
  { name: '机坪安全三班', regions: ['T2机坪'] },
]

export const ALL_REGIONS: string[] = SAFETY_TEAMS.flatMap((team) => team.regions)

export const DUTY_TEAM: SafetyTeam = SAFETY_TEAMS.find((team) => team.duty) ?? SAFETY_TEAMS[0]

export function teamByName(name: string): SafetyTeam | undefined {
  return SAFETY_TEAMS.find((team) => team.name === name)
}

export function teamOfRegion(region: string): SafetyTeam | undefined {
  const target = region.trim()
  return SAFETY_TEAMS.find((team) => team.regions.includes(target))
}

export function isKnownRegion(region: string): boolean {
  return ALL_REGIONS.includes(region.trim())
}
