<script setup lang="ts">
import { toRefs } from 'vue'
import type { BroadcastChannel } from '../../shared/types'
import { useControlContext } from './context'

const {
  selectedMatch, broadcastRevision, appOrigin, channelLabel, copyObsUrl
} = toRefs(useControlContext())

const channels: BroadcastChannel[] = ['match', 'songs', 'results', 'bracket']
</script>

<template>
  <section class="page-section">
    <div class="section-heading"><div><span>LIVE MONITOR</span><h2>播出监看</h2><p>其他页面保存后会自动同步到 OBS；这里仅显示当前直播画面并提供浏览器源地址。</p></div><div class="selected-broadcast" v-if="selectedMatch">信号源：{{ selectedMatch.player1?.name }} vs {{ selectedMatch.player2?.name }}</div></div>
    <div class="broadcast-grid">
      <article v-for="channel in channels" :key="channel" class="broadcast-card">
        <div class="broadcast-head"><div><span><i></i> {{ channel.toUpperCase() }} OUTPUT</span><h3>{{ channelLabel(channel) }}</h3></div><b>R{{ broadcastRevision[channel] || 0 }}</b></div>
        <div class="broadcast-frame"><iframe :id="`broadcast-frame-${channel}`" :src="`/obs/${channel}`" :title="`${channelLabel(channel)}当前直播画面`"></iframe></div>
        <div class="source-url"><code>{{ `${appOrigin}/obs/${channel}` }}</code><button @click="copyObsUrl(channel)">复制</button></div>
      </article>
    </div>
  </section>
</template>
