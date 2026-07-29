import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import ControlPage from './pages/ControlPage.vue'
import ObsPage from './pages/ObsPage.vue'
import './styles.css'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/control' },
    { path: '/control', component: ControlPage },
    { path: '/obs/match', component: ObsPage, props: { channel: 'match' } },
    { path: '/obs/songs', component: ObsPage, props: { channel: 'songs' } },
    { path: '/obs/results', component: ObsPage, props: { channel: 'results' } },
    { path: '/obs/bracket', component: ObsPage, props: { channel: 'bracket' } }
  ]
})

createApp(App).use(router).mount('#app')
