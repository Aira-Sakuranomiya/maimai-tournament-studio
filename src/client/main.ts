import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import ControlPage from './pages/ControlPage.vue'
import ObsPage from './pages/ObsPage.vue'
import OverviewSection from './control/OverviewSection.vue'
import PlayersSection from './control/PlayersSection.vue'
import TeamsSection from './control/TeamsSection.vue'
import MatchesSection from './control/MatchesSection.vue'
import BroadcastSection from './control/BroadcastSection.vue'
import './styles.css'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/control/overview' },
    {
      path: '/control',
      component: ControlPage,
      redirect: '/control/overview',
      children: [
        { path: 'overview', name: 'control-overview', component: OverviewSection },
        { path: 'players', name: 'control-players', component: PlayersSection },
        { path: 'teams', name: 'control-teams', component: TeamsSection },
        { path: 'matches', name: 'control-matches', component: MatchesSection },
        { path: 'broadcast', name: 'control-broadcast', component: BroadcastSection }
      ]
    },
    { path: '/obs/match', component: ObsPage, props: { channel: 'match' } },
    { path: '/obs/songs', component: ObsPage, props: { channel: 'songs' } },
    { path: '/obs/results', component: ObsPage, props: { channel: 'results' } },
    { path: '/obs/bracket', component: ObsPage, props: { channel: 'bracket' } }
  ]
})

createApp(App).use(router).mount('#app')
