<script setup lang="ts">
import { toRefs } from 'vue'
import { useRouter } from 'vue-router'
import { useControlContext } from './context'

const router = useRouter()
const {
  activeTournament, players, liveMatchCount, completedMatchCount, songCache
} = toRefs(useControlContext())
</script>

<template>
  <section class="page-section">
    <div class="hero-panel">
      <div>
        <span class="live-pill"><i></i> BROADCAST READY</span>
        <h2>MAIMAD.wav<br><em>TOURNAMENT STUDIO</em></h2>
        <p>从两队入场、曲目揭晓到成绩确认和加赛安排，各页面保存后都会立即同步到 OBS。</p>
        <div class="hero-actions">
          <button class="primary" @click="router.push(activeTournament ? '/control/matches' : '/control/players')">
            {{ activeTournament ? '进入对局控制' : '从玩家名单开始' }} <span>→</span>
          </button>
          <button class="ghost" @click="router.push('/control/broadcast')">检查播出源</button>
        </div>
      </div>
      <div class="hero-orbit">
        <div class="orbit-core">VS</div>
        <i v-for="n in 8" :key="n" :style="{ transform: `rotate(${n * 45}deg)` }"></i>
      </div>
    </div>
    <div class="metric-grid">
      <article><span>PLAYERS</span><strong>{{ players.length }}</strong><small>玩家库总人数</small></article>
      <article><span>LIVE MATCHES</span><strong>{{ liveMatchCount }}</strong><small>当前待进行对局</small></article>
      <article><span>PROGRESS</span><strong>{{ completedMatchCount }}</strong><small>已结算对战行</small></article>
      <article><span>SONG CACHE</span><strong>{{ songCache.count }}</strong><small>{{ songCache.updatedAt ? '本地曲库可用' : '等待首次同步' }}</small></article>
    </div>
    <div class="quick-grid">
      <button @click="router.push('/control/players')"><b>＋</b><span><strong>添加玩家</strong><small>姓名与自定义头像</small></span><i>→</i></button>
      <button @click="router.push('/control/teams')"><b>⌘</b><span><strong>队伍与对战行</strong><small>自由分队并选择当前行</small></span><i>→</i></button>
      <button @click="router.push('/control/broadcast')"><b>◉</b><span><strong>播出监看</strong><small>查看当前四路直播画面</small></span><i>→</i></button>
    </div>
  </section>
</template>
