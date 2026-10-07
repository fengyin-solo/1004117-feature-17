import { defineStore } from 'pinia'

import { APRON_TEAMS } from '@/data/apron-ownership'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    team: APRON_TEAMS[0],
    shiftLabel: '白班 08:00-20:00',
    scope: '机场地面保障调度管理系统',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    teams: () => APRON_TEAMS,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setTeam(team: string) {
      if (APRON_TEAMS.includes(team)) {
        this.team = team
      }
    },
  },
})
