<script setup lang="ts">
import { toRefs } from 'vue'
import type { BroadcastChannel } from '../../shared/types'
import { useControlContext } from './context'

const {
  selectedMatch, broadcastRevision, appOrigin, channelLabel, prepareBroadcast, publish, copyObsUrl
} = toRefs(useControlContext())

const channels: BroadcastChannel[] = ['match', 'songs', 'results', 'bracket']
</script>

<template>
  <section class="page-section">
    <div class="section-heading"><div><span>OUTPUT CONTROL</span><h2>播出控制</h2><p>先更新预览，确认无误后再把完整快照推送到 OBS。</p></div><div class="selected-broadcast" v-if="selectedMatch">信号源：{{ selectedMatch.player1?.name }} vs {{ selectedMatch.player2?.name }}</div></div>
    <div class="broadcast-grid">
      <article v-for="channel in channels" :key="channel" class="broadcast-card">
        <div class="broadcast-head"><div><span><i></i> {{ channel.toUpperCase() }} OUTPUT</span><h3>{{ channelLabel(channel) }}</h3></div><b>R{{ broadcastRevision[channel] || 0 }}</b></div>
        <div class="preview-frame"><iframe :id="`preview-${channel}`" :src="`/obs/${channel}?preview=1`" :title="`${channelLabel(channel)}预览`"></iframe></div>
        <div class="broadcast-actions"><button class="secondary" @click="prepareBroadcast(channel)">更新预览</button><button class="primary" @click="publish(channel)">推送到直播</button></div>
        <div class="source-url"><code>{{ `${appOrigin}/obs/${channel}` }}</code><button @click="copyObsUrl(channel)">复制</button></div>
      </article>
    </div>
  </section>
</template>
