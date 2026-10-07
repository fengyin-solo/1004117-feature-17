import { defineStore } from 'pinia'

import { SAFETY_TEAMS } from '@/data/teams'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '机场地面保障调度管理系统',
    // 当前登录班组：机坪安全的整改归属权限以此判定
    team: SAFETY_TEAMS[0].name,
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    currentTeam: (state) => SAFETY_TEAMS.find((item) => item.name === state.team) ?? SAFETY_TEAMS[0],
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setTeam(name: string) {
      if (SAFETY_TEAMS.some((item) => item.name === name)) {
        this.team = name
      }
    },
  },
})
