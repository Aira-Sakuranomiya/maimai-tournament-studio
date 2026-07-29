<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { io, type Socket } from 'socket.io-client'
import { api } from '../api'
import type { BroadcastChannel, BroadcastState } from '../../shared/types'
import { difficultyClass, difficultyName } from '../../shared/difficulty'

const props = defineProps<{ channel: BroadcastChannel }>()
const payload = ref<any>(null)
const viewport = ref({ width: window.innerWidth, height: window.innerHeight })
const preview = new URLSearchParams(location.search).get('preview') === '1'
let socket: Socket | null = null

const scale = computed(() => Math.min(viewport.value.width / 1920, viewport.value.height / 1080))
function colorRgb(color: string | undefined, fallback: string) {
  const value = /^#[0-9a-f]{6}$/i.test(color || '') ? color! : fallback
  return `${parseInt(value.slice(1, 3), 16)},${parseInt(value.slice(3, 5), 16)},${parseInt(value.slice(5, 7), 16)}`
}
const stageStyle = computed(() => ({
  transform: `translate(-50%, -50%) scale(${scale.value})`,
  '--p1': payload.value?.tournament?.team1Color || '#42e8dc',
  '--p2': payload.value?.tournament?.team2Color || '#ff5a9d',
  '--p1-rgb': colorRgb(payload.value?.tournament?.team1Color, '#42e8dc'),
  '--p2-rgb': colorRgb(payload.value?.tournament?.team2Color, '#ff5a9d')
}))
const rounds = computed(() => {
  if (!payload.value?.matches) return []
  const grouped = new Map<number, any[]>()
  for (const match of payload.value.matches) {
    if (!grouped.has(match.roundIndex)) grouped.set(match.roundIndex, [])
    grouped.get(match.roundIndex)!.push(match)
  }
  return [...grouped.entries()].map(([index, matches]) => ({ index, matches }))
})
const boardMatches = computed(() => {
  const matches = payload.value?.matches || []
  if (matches.length <= 16) return matches
  const recent = matches.slice(-16)
  const current = matches.find((match: any) => match.id === payload.value?.currentMatchId)
  return current && !recent.some((match: any) => match.id === current.id)
    ? [current, ...recent.slice(1)]
    : recent
})
const resultTotals = computed(() => {
  const match = payload.value?.match
  if (!match) return { one: 0, two: 0 }
  const sumSavedScores = (side: 1 | 2) => (match.songs || []).reduce((sum: number, song: any) => {
    const score = song[`score${side}`]
    return score == null ? sum : sum + Math.round(Number(score) * 10000)
  }, 0) / 10000
  return {
    one: match.total1 == null ? sumSavedScores(1) : Number(match.total1),
    two: match.total2 == null ? sumSavedScores(2) : Number(match.total2)
  }
})

function roundName(index: number, total: number) {
  const left = total - index
  if (left === 1) return 'GRAND FINAL'
  if (left === 2) return 'SEMI FINAL'
  if (left === 3) return 'QUARTER FINAL'
  return `ROUND ${index + 1}`
}
function matchLabel(match: any) {
  return match?.isTiebreak ? 'TIEBREAK' : `BATTLE ${String((match?.matchIndex || 0) + 1).padStart(2, '0')}`
}
function teamName(side: 1 | 2) {
  return payload.value?.tournament?.[`team${side}Name`] || (side === 1 ? 'TEAM 1' : 'TEAM 2')
}
function playerNameStyle(name: string | undefined) {
  const length = Array.from(name || '').length
  const fontSize = length <= 6 ? 48 : length <= 10 ? 42 : length <= 16 ? 34 : 28
  return { fontSize: `${fontSize}px` }
}
function sourceLabel(source: string) {
  return ({ '1p': '1P PICK', '2p': '2P PICK', required: '课题曲', tiebreak: 'TIEBREAK' } as any)[source] || source
}
function fit() { viewport.value = { width: window.innerWidth, height: window.innerHeight } }

onMounted(async () => {
  const state = await api<BroadcastState>(`/api/broadcast/${props.channel}`)
  payload.value = preview ? state.draft : state.published
  socket = io()
  socket.on(preview ? 'broadcast:draft' : 'broadcast:update', (message: any) => {
    if (message.channel !== props.channel) return
    payload.value = message.data
  })
  window.addEventListener('resize', fit)
})
onBeforeUnmount(() => {
  socket?.disconnect()
  window.removeEventListener('resize', fit)
})
</script>

<template>
  <div class="obs-viewport">
    <div class="obs-stage" :class="`obs-${channel}`" :style="stageStyle">
      <div v-if="channel === 'match'" class="obs-match-background"></div>
      <div v-else class="obs-main-background"></div>

      <div v-if="!payload" class="obs-empty">
        <div class="empty-disc"><i></i><b>WAIT</b></div>
        <h1>等待导播推送</h1><p>STANDING BY FOR DIRECTOR SIGNAL</p>
      </div>

      <template v-else-if="channel === 'match'">
        <div class="match-design-player match-design-player-one">
          <div class="match-design-avatar">
            <img v-if="payload.match.player1?.avatarUrl" :src="payload.match.player1.avatarUrl" />
            <b v-else>{{ payload.match.player1?.name?.[0] || '?' }}</b>
          </div>
          <strong :style="playerNameStyle(payload.match.player1?.name)">{{ payload.match.player1?.name || '待定' }}</strong>
        </div>
        <div class="match-design-player match-design-player-two">
          <strong :style="playerNameStyle(payload.match.player2?.name)">{{ payload.match.player2?.name || '待定' }}</strong>
          <div class="match-design-avatar">
            <img v-if="payload.match.player2?.avatarUrl" :src="payload.match.player2.avatarUrl" />
            <b v-else>{{ payload.match.player2?.name?.[0] || '?' }}</b>
          </div>
        </div>
      </template>

      <template v-else-if="channel === 'songs'">
        <header class="obs-title compact"><span>NEXT TRACKS</span><h1>曲目揭晓</h1><p>{{ payload.match.player1?.name }} VS {{ payload.match.player2?.name }}</p></header>
        <div class="obs-song-grid" :class="{ single: payload.match.songs.length === 1, triple: payload.match.songs.length === 3, many: payload.match.songs.length > 3 }">
          <article v-for="(song, index) in payload.match.songs" :key="song.id">
            <div class="jacket-frame"><img :src="song.jacketUrl" /><span>{{ String(index + 1).padStart(2, '0') }}</span></div>
            <div class="song-meta"><span :class="`source-${song.source}`">{{ sourceLabel(song.source) }}</span><small class="obs-difficulty-line"><i class="difficulty-badge" :class="difficultyClass(song.levelIndex)">{{ difficultyName(song.levelIndex) }}</i><strong>LV {{ song.level }}</strong><em>{{ song.chartType.toUpperCase() }}</em></small><h2>{{ song.title }}</h2><p>{{ song.artist }}</p></div>
          </article>
        </div>
        <footer class="obs-footer"><span>SELECTED TRACKS</span><i></i><b>{{ payload.match.songs.length }} SONG{{ payload.match.songs.length === 1 ? '' : 'S' }}</b><i></i><span>GET READY</span></footer>
      </template>

      <template v-else-if="channel === 'results'">
        <header class="obs-title compact"><span>MATCH RESULT</span><h1>本轮成绩</h1><p>{{ matchLabel(payload.match) }} · {{ teamName(1) }} VS {{ teamName(2) }}</p></header>
        <div class="result-board">
          <div class="result-players">
            <div class="result-player one"><img v-if="payload.match.player1?.avatarUrl" :src="payload.match.player1.avatarUrl" /><span><small>{{ teamName(1) }} · 1P</small><b>{{ payload.match.player1?.name }}</b></span></div>
            <div class="result-label">VS</div>
            <div class="result-player two"><span><small>{{ teamName(2) }} · 2P</small><b>{{ payload.match.player2?.name }}</b></span><img v-if="payload.match.player2?.avatarUrl" :src="payload.match.player2.avatarUrl" /></div>
          </div>
          <div class="result-row" v-for="(song, index) in payload.match.songs" :key="song.id">
            <strong class="one">{{ song.score1 == null ? '—' : Number(song.score1).toFixed(4) }}<small>%</small></strong>
            <div><span>{{ String(index + 1).padStart(2, '0') }}</span><img :src="song.jacketUrl" /><p><b>{{ song.title }}</b><small><span>{{ sourceLabel(song.source) }}</span><i class="difficulty-text" :class="difficultyClass(song.levelIndex)">{{ difficultyName(song.levelIndex) }}</i><span>LV {{ song.level }}</span></small></p></div>
            <strong class="two">{{ song.score2 == null ? '—' : Number(song.score2).toFixed(4) }}<small>%</small></strong>
          </div>
          <div class="result-total">
            <strong class="one">{{ resultTotals.one.toFixed(4) }}<small>%</small></strong>
            <div><span>TOTAL</span></div>
            <strong class="two">{{ resultTotals.two.toFixed(4) }}<small>%</small></strong>
          </div>
        </div>
      </template>

      <template v-else-if="channel === 'bracket' && payload.tournament?.mode !== 'teams'">
        <header class="obs-title bracket-title"><span>TOURNAMENT BRACKET</span><h1>淘汰赛晋级图</h1><p>{{ payload.tournament.bracketSize }} PLAYER DRAW</p></header>
        <div class="bracket-board" :class="`rounds-${rounds.length}`">
          <section v-for="round in rounds" :key="round.index">
            <h3>{{ roundName(round.index, rounds.length) }}</h3>
            <div class="bracket-column">
              <article v-for="match in round.matches" :key="match.id" :class="{ active: match.status === 'pending', done: match.status === 'completed' || match.status === 'bye' }">
                <div :class="{ winner: match.winnerId === match.player1?.id }"><span>{{ match.player1?.name || 'TBD' }}</span><b>{{ match.total1 == null ? '' : Number(match.total1).toFixed(4) }}</b></div>
                <div :class="{ winner: match.winnerId === match.player2?.id }"><span>{{ match.player2?.name || (match.status === 'bye' ? 'BYE' : 'TBD') }}</span><b>{{ match.total2 == null ? '' : Number(match.total2).toFixed(4) }}</b></div>
              </article>
            </div>
          </section>
        </div>
        <footer class="obs-footer"><span>LIVE BRACKET</span><i></i><b>{{ payload.tournament.status.toUpperCase() }}</b><i></i><span>{{ payload.matches.filter((m:any) => m.status === 'completed' || m.status === 'bye').length }} / {{ payload.matches.length }} RESOLVED</span></footer>
      </template>

      <template v-else-if="channel === 'bracket'">
        <header class="obs-title team-board-title"><h1><em :style="{ color: payload.tournament.team1Color }">{{ teamName(1) }}</em><b>{{ payload.score.team1 }} : {{ payload.score.team2 }}</b><em :style="{ color: payload.tournament.team2Color }">{{ teamName(2) }}</em></h1></header>
        <div class="obs-team-board">
          <section class="obs-team-roster one">
            <h2>{{ teamName(1) }}</h2>
            <div>
              <article v-for="player in payload.members.team1" :key="player.id">
                <span><img v-if="player.avatarUrl" :src="player.avatarUrl" /><b v-else>{{ player.name?.[0] }}</b></span><strong>{{ player.name }}</strong>
              </article>
            </div>
          </section>

          <section class="obs-battle-log">
            <div>
              <article v-for="match in boardMatches" :key="match.id" :class="{ current: payload.currentMatchId === match.id, completed: match.status === 'completed', tiebreak: match.isTiebreak }">
                <span>{{ match.isTiebreak ? 'TB' : String(match.matchIndex + 1).padStart(2, '0') }}</span>
                <strong class="one" :class="{ winner: match.winnerId === match.player1?.id }">{{ match.player1?.name || '待选择' }}</strong>
                <i>{{ match.status === 'completed' ? (match.winnerId ? 'DONE' : 'DRAW') : payload.currentMatchId === match.id ? 'LIVE' : 'VS' }}</i>
                <strong class="two" :class="{ winner: match.winnerId === match.player2?.id }">{{ match.player2?.name || '待选择' }}</strong>
              </article>
            </div>
          </section>

          <section class="obs-team-roster two">
            <h2>{{ teamName(2) }}</h2>
            <div>
              <article v-for="player in payload.members.team2" :key="player.id">
                <strong>{{ player.name }}</strong><span><img v-if="player.avatarUrl" :src="player.avatarUrl" /><b v-else>{{ player.name?.[0] }}</b></span>
              </article>
            </div>
          </section>
        </div>
      </template>
    </div>
  </div>
</template>
