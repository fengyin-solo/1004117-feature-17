import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { runMigrations } from './data/migrations'
import './styles/global.css'

// 启动先跑数据迁移（存量缺区域问题受控回填、放行结论初始化），再挂载页面
runMigrations()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
