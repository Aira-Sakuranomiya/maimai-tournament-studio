<script setup lang="ts">
import { computed, onMounted, provide, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { api, ApiError, json } from '../api'
import type { BracketMatch, BroadcastChannel, MatchSong, Player, SongSearchResult, TeamBoard, Tournament } from '../../shared/types'
import { difficultyClass, difficultyName } from '../../shared/difficulty'
import { controlContextKey } from '../control/context'

type BracketPayload = { tournament: Tournament; matches: BracketMatch[] }

const sections = [
  { id: 'overview', label: '总览', mark: '01', to: '/control/overview', routeName: 'control-overview' },
  { id: 'players', label: '玩家库', mark: '02', to: '/control/players', routeName: 'control-players' },
  { id: 'teams', label: '队伍编排', mark: '03', to: '/control/teams', routeName: 'control-teams' },
  { id: 'matches', label: '对局控制', mark: '04', to: '/control/matches', routeName: 'control-matches' },
  { id: 'broadcast', label: '播出监看', mark: '05', to: '/control/broadcast', routeName: 'control-broadcast' }
]
const broadcastChannels: BroadcastChannel[] = ['match', 'songs', 'results', 'bracket']
const route = useRoute()
const activeSection = computed(() => sections.find((item) => item.routeName === route.name)?.id || 'overview')
const players = ref<Player[]>([])
const activeTournament = ref<Tournament | null>(null)
const bracket = ref<BracketPayload | null>(null)
const teamBoard = ref<TeamBoard | null>(null)
const selectedMatch = ref<BracketMatch | null>(null)
const newPlayerName = ref('')
const pairingDraft = reactive<Record<number, { player1Id: number | null; player2Id: number | null }>>({})
const team1Name = ref('黄队')
const team1Color = ref('#f5c84c')
const team2Name = ref('绿队')
const team2Color = ref('#55d68b')
const savedTeamSettings = reactive({
  team1Name: '黄队',
  team1Color: '#f5c84c',
  team2Name: '绿队',
  team2Color: '#55d68b'
})
const team1PlayerIds = ref<number[]>([])
const team2PlayerIds = ref<number[]>([])
const addTeam1PlayerId = ref<number | null>(null)
const addTeam2PlayerId = ref<number | null>(null)
const songQuery = ref('')
const songResults = ref<SongSearchResult[]>([])
const chosenSongs = ref<MatchSong[]>([])
const songCache = ref<{ count: number; updatedAt: string | null }>({ count: 0, updatedAt: null })
const scoreDraft = reactive<Record<string, string | number>>({})
const savedScoreDraft = reactive<Record<string, string | number>>({})
const appOrigin = window.location.origin
const busy = ref('')
const toast = ref<{ message: string; kind: 'ok' | 'error' } | null>(null)
const tiePending = ref(false)
const broadcastRevision = reactive<Record<string, number>>({ match: 0, songs: 0, results: 0, bracket: 0 })
let searchTimer: number | undefined

const pendingMatches = computed(() => bracket.value?.matches || [])
const liveMatchCount = computed(() => bracket.value?.matches.filter((match) => match.status === 'pending').length || 0)
const completedMatchCount = computed(() => bracket.value?.matches.filter((match) => match.status === 'completed' || match.status === 'bye').length || 0)
const availableForTeam1 = computed(() => players.value.filter((player) => !team1PlayerIds.value.includes(player.id) && !team2PlayerIds.value.includes(player.id)))
const availableForTeam2 = availableForTeam1
const teamSettingsDirty = computed(() =>
  team1Name.value !== savedTeamSettings.team1Name
  || team1Color.value !== savedTeamSettings.team1Color
  || team2Name.value !== savedTeamSettings.team2Name
  || team2Color.value !== savedTeamSettings.team2Color
)
const scoreProgress = computed(() => {
  const match = selectedMatch.value
  if (!match?.player1 || !match.player2) return { completed: 0, total: chosenSongs.value.length, allComplete: false }
  const completed = chosenSongs.value.filter((song) => {
    if (!song.id) return false
    const first = scoreDraft[`${song.id}-${match.player1!.id}`]
    const second = scoreDraft[`${song.id}-${match.player2!.id}`]
    return String(first ?? '').trim() !== '' && String(second ?? '').trim() !== ''
  }).length
  return {
    completed,
    total: chosenSongs.value.length,
    allComplete: chosenSongs.value.length > 0 && completed === chosenSongs.value.length
  }
})
const scoreDirty = computed(() => {
  const match = selectedMatch.value
  if (!match?.player1 || !match.player2) return false
  return chosenSongs.value.some((song) => {
    if (!song.id) return false
    return [match.player1!.id, match.player2!.id].some((playerId) => {
      const key = `${song.id}-${playerId}`
      return String(scoreDraft[key] ?? '').trim() !== String(savedScoreDraft[key] ?? '').trim()
    })
  })
})
const controlStyle = computed(() => ({
  '--p1': '#348cff',
  '--p2': '#348cff',
  '--p1-rgb': '52,140,255',
  '--p2-rgb': '52,140,255'
}))

function notify(message: string, kind: 'ok' | 'error' = 'ok') {
  toast.value = { message, kind }
  window.setTimeout(() => { toast.value = null }, 3500)
}

async function run(label: string, task: () => Promise<void>) {
  busy.value = label
  try { await task() }
  catch (error) { notify(error instanceof Error ? error.message : '操作失败', 'error') }
  finally { busy.value = '' }
}

async function loadAll() {
  const [playerData, boardData, cacheData, broadcastStates] = await Promise.all([
    api<Player[]>('/api/players'),
    api<TeamBoard>('/api/team-board'),
    api<{ count: number; updatedAt: string | null }>('/api/songs/cache'),
    Promise.all(broadcastChannels.map((channel) => api<any>(`/api/broadcast/${channel}`)))
  ])
  players.value = playerData
  songCache.value = cacheData
  broadcastStates.forEach((state) => { broadcastRevision[state.channel] = state.revision })
  applyTeamBoard(boardData)
}

async function publishLiveChanges(channels: BroadcastChannel[]) {
  try {
    const result = await api<{ states: Array<{ channel: BroadcastChannel; revision: number }> }>(
      '/api/broadcast/refresh',
      json('POST', { channels })
    )
    result.states.forEach((state) => { broadcastRevision[state.channel] = state.revision })
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    throw new Error(`内容已保存，但直播画面同步失败：${message}`)
  }
}

function applyTeamBoard(board: TeamBoard) {
  teamBoard.value = board
  activeTournament.value = board.tournament
  bracket.value = { tournament: board.tournament, matches: board.matches }
  team1Name.value = board.tournament.team1Name || '黄队'
  team1Color.value = board.tournament.team1Color || '#f5c84c'
  team2Name.value = board.tournament.team2Name || '绿队'
  team2Color.value = board.tournament.team2Color || '#55d68b'
  savedTeamSettings.team1Name = team1Name.value
  savedTeamSettings.team1Color = team1Color.value
  savedTeamSettings.team2Name = team2Name.value
  savedTeamSettings.team2Color = team2Color.value
  team1PlayerIds.value = board.members.team1.map((player) => player.id)
  team2PlayerIds.value = board.members.team2.map((player) => player.id)
  Object.keys(pairingDraft).forEach((key) => delete pairingDraft[Number(key)])
  for (const match of board.matches) {
    pairingDraft[match.id] = {
      player1Id: match.player1?.id || null,
      player2Id: match.player2?.id || null
    }
  }
  selectedMatch.value = board.matches.find((match) => match.id === board.currentMatchId)
    || board.matches[0]
    || null
  if (selectedMatch.value) hydrateMatch(selectedMatch.value)
}

async function loadTeamBoard() {
  applyTeamBoard(await api<TeamBoard>('/api/team-board'))
}

async function loadTournament(_id?: number) {
  await loadTeamBoard()
}

function hydrateMatch(match: BracketMatch) {
  selectedMatch.value = match
  chosenSongs.value = match.songs ? JSON.parse(JSON.stringify(match.songs)) : []
  Object.keys(scoreDraft).forEach((key) => delete scoreDraft[key])
  Object.keys(savedScoreDraft).forEach((key) => delete savedScoreDraft[key])
  for (const song of chosenSongs.value) {
    if (song.id && match.player1) scoreDraft[`${song.id}-${match.player1.id}`] = song.score1 == null ? '' : Number(song.score1).toFixed(4)
    if (song.id && match.player2) scoreDraft[`${song.id}-${match.player2.id}`] = song.score2 == null ? '' : Number(song.score2).toFixed(4)
  }
  Object.assign(savedScoreDraft, scoreDraft)
  tiePending.value = false
}

async function createPlayer() {
  if (!newPlayerName.value.trim()) return
  await run('player', async () => {
    await api('/api/players', json('POST', { name: newPlayerName.value }))
    newPlayerName.value = ''
    players.value = await api<Player[]>('/api/players')
    notify('玩家已加入名单')
  })
}

async function renamePlayer(player: Player) {
  const name = window.prompt('输入新的玩家名称', player.name)
  if (!name?.trim() || name.trim() === player.name) return
  await run('player', async () => {
    await api(`/api/players/${player.id}`, json('PATCH', { name }))
    players.value = await api<Player[]>('/api/players')
    await loadTeamBoard()
    await publishLiveChanges(broadcastChannels)
    notify('玩家名称已更新并同步直播')
  })
}

async function uploadAvatar(player: Player, event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  const form = new FormData()
  form.append('file', file)
  await run('avatar', async () => {
    await api(`/api/players/${player.id}/avatar`, { method: 'POST', body: form })
    players.value = await api<Player[]>('/api/players')
    await loadTeamBoard()
    await publishLiveChanges(broadcastChannels)
    notify('头像已更新并同步直播')
  })
}

async function deletePlayer(player: Player) {
  if (!window.confirm(`删除玩家“${player.name}”？`)) return
  await run('player', async () => {
    await api(`/api/players/${player.id}`, { method: 'DELETE' })
    players.value = await api<Player[]>('/api/players')
    team1PlayerIds.value = team1PlayerIds.value.filter((id) => id !== player.id)
    team2PlayerIds.value = team2PlayerIds.value.filter((id) => id !== player.id)
    notify('玩家已删除')
  })
}

async function saveTeamSettings() {
  await run('teams', async () => {
    applyTeamBoard(await api<TeamBoard>('/api/team-board/settings', json('PUT', {
      team1Name: team1Name.value, team1Color: team1Color.value,
      team2Name: team2Name.value, team2Color: team2Color.value
    })))
    await publishLiveChanges(broadcastChannels)
    notify('队名与颜色已保存并同步直播')
  })
}

async function persistTeamMembers() {
  applyTeamBoard(await api<TeamBoard>('/api/team-board/members', json('PUT', {
    team1PlayerIds: team1PlayerIds.value,
    team2PlayerIds: team2PlayerIds.value
  })))
  await publishLiveChanges(['bracket'])
}

async function addPlayerToTeam(team: 1 | 2) {
  const playerId = team === 1 ? addTeam1PlayerId.value : addTeam2PlayerId.value
  if (!playerId) return
  await run('members', async () => {
    if (team === 1) team1PlayerIds.value.push(playerId)
    else team2PlayerIds.value.push(playerId)
    await persistTeamMembers()
    addTeam1PlayerId.value = null
    addTeam2PlayerId.value = null
    notify(`玩家已加入${team === 1 ? team1Name.value : team2Name.value}并同步直播`)
  })
}

async function removePlayerFromTeam(team: 1 | 2, playerId: number) {
  await run('members', async () => {
    if (team === 1) team1PlayerIds.value = team1PlayerIds.value.filter((id) => id !== playerId)
    else team2PlayerIds.value = team2PlayerIds.value.filter((id) => id !== playerId)
    await persistTeamMembers()
    notify('队伍名单已更新并同步直播')
  })
}

async function resetRound() {
  if (!window.confirm(
    '确定清空本轮并重新开始吗？\n\n双方名单、对战行、曲目、成绩和比分都会清空；玩家库、队名和颜色会保留，直播画面将立即同步为空白回合。'
  )) return
  await run('round-reset', async () => {
    applyTeamBoard(await api<TeamBoard>('/api/team-board/reset', { method: 'POST' }))
    await publishLiveChanges(broadcastChannels)
    notify('本轮已清空并同步直播，可以重新分队和编排')
  })
}

async function saveTeamRow(match: BracketMatch) {
  await run(`row-${match.id}`, async () => {
    applyTeamBoard(await api<TeamBoard>(`/api/team-board/rows/${match.id}`, json('PUT', {
      player1Id: pairingDraft[match.id]?.player1Id || null,
      player2Id: pairingDraft[match.id]?.player2Id || null,
      isTiebreak: match.isTiebreak
    })))
    await publishLiveChanges(broadcastChannels)
    notify('对战行已保存并同步直播')
  })
}

function teamRowDirty(match: BracketMatch) {
  const draft = pairingDraft[match.id]
  if (!draft) return false
  return (draft.player1Id ?? null) !== (match.player1?.id ?? null)
    || (draft.player2Id ?? null) !== (match.player2?.id ?? null)
}

async function addTeamMatchRow(isTiebreak = false) {
  await run('row-add', async () => {
    const match = await api<BracketMatch>('/api/team-board/rows', json('POST', { isTiebreak }))
    await loadTeamBoard()
    await publishLiveChanges(['bracket'])
    notify(isTiebreak ? '加赛行已添加并同步直播' : '对战行已添加并同步直播')
    if (match) pairingDraft[match.id] = { player1Id: null, player2Id: null }
  })
}

async function deleteTeamMatchRow(match: BracketMatch) {
  if (!window.confirm(`删除第 ${match.matchIndex + 1} 行？`)) return
  await run('row-delete', async () => {
    applyTeamBoard(await api<TeamBoard>(`/api/team-board/rows/${match.id}`, { method: 'DELETE' }))
    await publishLiveChanges(['bracket'])
    notify('对战行已删除并同步直播')
  })
}

async function setCurrentRow(match: BracketMatch) {
  await run('current-row', async () => {
    applyTeamBoard(await api<TeamBoard>(`/api/team-board/current/${match.id}`, { method: 'POST' }))
    await publishLiveChanges(broadcastChannels)
    notify(`当前已切换到第 ${match.matchIndex + 1} 行并同步直播`)
  })
}

async function selectMatch(match: BracketMatch) {
  await setCurrentRow(match)
}

watch(songQuery, () => {
  window.clearTimeout(searchTimer)
  if (!songQuery.value.trim()) { songResults.value = []; return }
  searchTimer = window.setTimeout(async () => {
    songResults.value = await api<SongSearchResult[]>(`/api/songs/search?q=${encodeURIComponent(songQuery.value)}`).catch(() => [])
  }, 220)
})

async function syncSongCache() {
  await run('sync', async () => {
    const result = await api<{ count: number; updatedAt: string }>('/api/songs/sync', { method: 'POST' })
    songCache.value = result
    notify(`曲库同步完成，共 ${result.count} 首`)
  })
}

function flattenDifficulties(song: SongSearchResult) {
  return Object.entries(song.difficulties || {}).flatMap(([type, difficulties]) =>
    (difficulties || []).map((difficulty) => ({ ...difficulty, type }))
  )
}

function addSong(song: SongSearchResult, chart: any) {
  chosenSongs.value.push({
    position: chosenSongs.value.length,
    songId: song.id,
    title: song.title,
    artist: song.artist,
    jacketUrl: `/api/songs/${song.id}/jacket`,
    chartType: chart.type,
    levelIndex: chart.difficulty,
    level: chart.level,
    source: 'required'
  })
  songQuery.value = ''
  songResults.value = []
}

function removeSong(index: number) {
  chosenSongs.value.splice(index, 1)
  chosenSongs.value.forEach((song, position) => { song.position = position })
}

function moveSong(fromIndex: number, toIndex: number) {
  if (
    fromIndex === toIndex
    || fromIndex < 0
    || toIndex < 0
    || fromIndex >= chosenSongs.value.length
    || toIndex >= chosenSongs.value.length
  ) return
  const [song] = chosenSongs.value.splice(fromIndex, 1)
  chosenSongs.value.splice(toIndex, 0, song)
  chosenSongs.value.forEach((item, position) => { item.position = position })
}

async function saveSongs() {
  if (!selectedMatch.value) return
  await run('songs', async () => {
    const updated = await api<BracketMatch>(`/api/matches/${selectedMatch.value!.id}/songs`, json('PUT', {
      songs: chosenSongs.value.map(({ id: _id, score1: _s1, score2: _s2, ...song }) => song)
    }))
    hydrateMatch(updated)
    await loadTournament(updated.tournamentId)
    await publishLiveChanges(['songs', 'results'])
    notify('曲目配置已保存并同步直播')
  })
}

async function saveScoreValues(requireComplete = false) {
  const match = selectedMatch.value
  if (!match?.player1 || !match.player2 || !chosenSongs.value.every((song) => song.id)) {
    throw new Error('当前对局还不能录入成绩')
  }
  const scores: Array<{ songId: number; playerId: number; achievement: number | null }> = []
  let completed = 0
  for (const [index, song] of chosenSongs.value.entries()) {
    const firstRaw = scoreDraft[`${song.id}-${match.player1.id}`]
    const secondRaw = scoreDraft[`${song.id}-${match.player2.id}`]
    const firstText = String(firstRaw ?? '').trim()
    const secondText = String(secondRaw ?? '').trim()
    const first = firstText ? Number(firstText) : null
    const second = secondText ? Number(secondText) : null
    if ([first, second].some((value) => value != null && (!Number.isFinite(value) || value < 0 || value > 101))) {
      throw new Error(`第 ${index + 1} 首达成率必须在 0 到 101 之间`)
    }
    scores.push(
      { songId: song.id!, playerId: match.player1.id, achievement: first },
      { songId: song.id!, playerId: match.player2.id, achievement: second }
    )
    if (first != null && second != null) completed++
  }
  if (requireComplete && completed !== chosenSongs.value.length) throw new Error('请先完整录入每首曲目的双方成绩')
  const updated = await api<BracketMatch>(`/api/matches/${match.id}/scores`, json('PUT', { scores }))
  hydrateMatch(updated)
  return { updated, completed }
}

async function savePartialScores() {
  await run('score-save', async () => {
    const result = await saveScoreValues(false)
    if (!result) return
    await publishLiveChanges(['results'])
    notify(`已保存 ${result.completed} 首成绩并同步直播`)
  })
}

async function confirmResult(manualWinnerId?: number) {
  if (!selectedMatch.value) return
  await run('score', async () => {
    await saveScoreValues(true)
    try {
      await api<BracketMatch>(`/api/matches/${selectedMatch.value!.id}/confirm`, json('POST', manualWinnerId ? { manualWinnerId } : {}))
      tiePending.value = false
      await loadTournament(selectedMatch.value!.tournamentId)
      await publishLiveChanges(['results', 'bracket'])
      const completed = selectedMatch.value
      if (completed?.winnerId) notify('本行赛果已确认，队伍比分已更新')
      else {
        tiePending.value = true
        notify('本行总分相同，未计队伍胜场；请添加加赛行', 'error')
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'TIE_REQUIRES_WINNER') {
        tiePending.value = true
        notify('双方总分相同，请手动指定晋级者', 'error')
        return
      }
      throw error
    }
  })
}

async function reopenSelected() {
  if (!selectedMatch.value) return
  await run('score', async () => {
    try {
      await api(`/api/matches/${selectedMatch.value!.id}/reopen`, json('POST', { clearDownstream: false }))
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'DOWNSTREAM_HAS_DATA') throw error
      if (!window.confirm('后续对局已有内容。继续将清除受影响的后续曲目和成绩，确认吗？')) return
      await api(`/api/matches/${selectedMatch.value!.id}/reopen`, json('POST', { clearDownstream: true }))
    }
    await loadTournament(selectedMatch.value!.tournamentId)
    await publishLiveChanges(['results', 'bracket'])
    notify('对局已重新打开并同步直播')
  })
}

async function copyObsUrl(channel: BroadcastChannel) {
  try {
    await window.navigator.clipboard.writeText(`${appOrigin}/obs/${channel}`)
    notify('OBS 地址已复制')
  } catch {
    notify('复制失败，请手动复制地址', 'error')
  }
}

function channelLabel(channel: BroadcastChannel) {
  return ({ match: '主界面', songs: '曲目展示', results: '成绩页', bracket: '队伍战况' })[channel]
}

function playerById(id: number | null) { return players.value.find((player) => player.id === id) }
function matchLabel(match: BracketMatch) {
  return match.isTiebreak ? '加赛' : `对战行 ${String(match.matchIndex + 1).padStart(2, '0')}`
}
function sourceLabel(source: string) { return ({ '1p': '1P 选曲', '2p': '2P 选曲', required: '课题曲', tiebreak: '加赛曲' } as any)[source] }

provide(controlContextKey, reactive({
  players, activeTournament, bracket, teamBoard, selectedMatch, newPlayerName, pairingDraft,
  team1Name, team1Color, team2Name, team2Color, team1PlayerIds, team2PlayerIds,
  addTeam1PlayerId, addTeam2PlayerId, songQuery, songResults, chosenSongs, songCache,
  scoreDraft, appOrigin, busy, tiePending, broadcastRevision, pendingMatches, liveMatchCount,
  completedMatchCount, availableForTeam1, availableForTeam2, teamSettingsDirty,
  scoreProgress, scoreDirty,
  createPlayer, renamePlayer, uploadAvatar, deletePlayer, saveTeamSettings, addPlayerToTeam,
  removePlayerFromTeam, resetRound, saveTeamRow, teamRowDirty, addTeamMatchRow, deleteTeamMatchRow,
  setCurrentRow, selectMatch, syncSongCache, flattenDifficulties, addSong, removeSong, moveSong, saveSongs,
  savePartialScores, confirmResult, reopenSelected, copyObsUrl, channelLabel, playerById,
  matchLabel, sourceLabel, difficultyClass, difficultyName
}))

onMounted(() => run('init', loadAll))
</script>

<template>
  <div class="control-shell" :style="controlStyle">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-disc"><i></i></div>
        <div><strong>MADMAI.wav</strong><span>TOURNAMENT STUDIO</span></div>
      </div>
      <nav>
        <RouterLink
          v-for="item in sections"
          :key="item.id"
          :to="item.to"
          custom
          v-slot="{ navigate }"
        >
          <button :class="{ active: activeSection === item.id }" @click="navigate">
            <span>{{ item.mark }}</span>{{ item.label }}
          </button>
        </RouterLink>
      </nav>
      <div class="sidebar-foot">
        <div class="status-row"><i></i><span>LOCAL SERVER</span><b>ONLINE</b></div>
        <small>OBS 输出 · 1920 × 1080</small>
      </div>
    </aside>

    <main class="control-main">
      <header class="topbar">
        <div>
          <p class="eyebrow">LIVE OPERATION CONSOLE</p>
          <h1>{{ sections.find(item => item.id === activeSection)?.label }}</h1>
        </div>
        <div class="event-chip" v-if="activeTournament">
          <span>当前对战</span><strong>{{ team1Name }} VS {{ team2Name }}</strong><i>进行中</i>
        </div>
        <div class="event-chip muted" v-else><span>当前赛事</span><strong>尚未创建</strong></div>
      </header>

      <RouterView />
    </main>

    <transition name="toast"><div v-if="toast" class="toast" :class="toast.kind"><i>{{ toast.kind === 'ok' ? '✓' : '!' }}</i>{{ toast.message }}</div></transition>
  </div>
</template>
