<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { api, ApiError, json } from '../api'
import type { BracketMatch, BroadcastChannel, MatchSong, Player, SongSearchResult, TeamBoard, Tournament } from '../../shared/types'
import { difficultyClass, difficultyName } from '../../shared/difficulty'

type BracketPayload = { tournament: Tournament; matches: BracketMatch[] }

const sections = [
  { id: 'overview', label: '总览', mark: '01' },
  { id: 'players', label: '玩家库', mark: '02' },
  { id: 'tournament', label: '队伍编排', mark: '03' },
  { id: 'match', label: '对局控制', mark: '04' },
  { id: 'broadcast', label: '播出控制', mark: '05' }
]
const activeSection = ref('overview')
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
const controlStyle = computed(() => ({
  '--p1': '#ff315f',
  '--p2': '#ff315f',
  '--p1-rgb': '255,49,95',
  '--p2-rgb': '255,49,95'
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
  const [playerData, boardData, cacheData] = await Promise.all([
    api<Player[]>('/api/players'),
    api<TeamBoard>('/api/team-board'),
    api<{ count: number; updatedAt: string | null }>('/api/songs/cache')
  ])
  players.value = playerData
  songCache.value = cacheData
  applyTeamBoard(boardData)
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
  for (const song of chosenSongs.value) {
    if (song.id && match.player1) scoreDraft[`${song.id}-${match.player1.id}`] = song.score1 == null ? '' : Number(song.score1).toFixed(4)
    if (song.id && match.player2) scoreDraft[`${song.id}-${match.player2.id}`] = song.score2 == null ? '' : Number(song.score2).toFixed(4)
  }
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
    notify('玩家名称已更新')
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
    notify('头像已更新')
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
    notify('队名与颜色已保存')
  })
}

async function persistTeamMembers() {
  applyTeamBoard(await api<TeamBoard>('/api/team-board/members', json('PUT', {
    team1PlayerIds: team1PlayerIds.value,
    team2PlayerIds: team2PlayerIds.value
  })))
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
    notify(`玩家已加入${team === 1 ? team1Name.value : team2Name.value}`)
  })
}

async function removePlayerFromTeam(team: 1 | 2, playerId: number) {
  await run('members', async () => {
    if (team === 1) team1PlayerIds.value = team1PlayerIds.value.filter((id) => id !== playerId)
    else team2PlayerIds.value = team2PlayerIds.value.filter((id) => id !== playerId)
    await persistTeamMembers()
    notify('队伍名单已更新')
  })
}

async function saveTeamRow(match: BracketMatch) {
  await run(`row-${match.id}`, async () => {
    applyTeamBoard(await api<TeamBoard>(`/api/team-board/rows/${match.id}`, json('PUT', {
      player1Id: pairingDraft[match.id]?.player1Id || null,
      player2Id: pairingDraft[match.id]?.player2Id || null,
      isTiebreak: match.isTiebreak
    })))
    notify('对战行已保存')
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
    notify(isTiebreak ? '加赛行已添加' : '对战行已添加')
    if (match) pairingDraft[match.id] = { player1Id: null, player2Id: null }
  })
}

async function deleteTeamMatchRow(match: BracketMatch) {
  if (!window.confirm(`删除第 ${match.matchIndex + 1} 行？`)) return
  await run('row-delete', async () => {
    applyTeamBoard(await api<TeamBoard>(`/api/team-board/rows/${match.id}`, { method: 'DELETE' }))
    notify('对战行已删除')
  })
}

async function setCurrentRow(match: BracketMatch) {
  await run('current-row', async () => {
    applyTeamBoard(await api<TeamBoard>(`/api/team-board/current/${match.id}`, { method: 'POST' }))
    notify(`当前已切换到第 ${match.matchIndex + 1} 行`)
  })
}

async function selectMatch(match: BracketMatch) {
  activeSection.value = 'match'
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

async function saveSongs() {
  if (!selectedMatch.value) return
  await run('songs', async () => {
    const updated = await api<BracketMatch>(`/api/matches/${selectedMatch.value!.id}/songs`, json('PUT', {
      songs: chosenSongs.value.map(({ id: _id, score1: _s1, score2: _s2, ...song }) => song)
    }))
    hydrateMatch(updated)
    await loadTournament(updated.tournamentId)
    notify('曲目配置已保存')
  })
}

async function saveScoreValues() {
  const match = selectedMatch.value
  if (!match?.player1 || !match.player2 || !chosenSongs.value.every((song) => song.id)) return
  const requiredKeys = chosenSongs.value.flatMap((song) => [
    `${song.id}-${match.player1!.id}`,
    `${song.id}-${match.player2!.id}`
  ])
  if (requiredKeys.some((key) => {
    const value = scoreDraft[key]
    return value == null || String(value).trim() === '' || !Number.isFinite(Number(value))
  })) {
    throw new Error('请完整填写每首曲目的双方成绩')
  }
  const scores = chosenSongs.value.flatMap((song) => [
    { songId: song.id!, playerId: match.player1!.id, achievement: Number(scoreDraft[`${song.id}-${match.player1!.id}`]) },
    { songId: song.id!, playerId: match.player2!.id, achievement: Number(scoreDraft[`${song.id}-${match.player2!.id}`]) }
  ])
  const updated = await api<BracketMatch>(`/api/matches/${match.id}/scores`, json('PUT', { scores }))
  hydrateMatch(updated)
}

async function confirmResult(manualWinnerId?: number) {
  if (!selectedMatch.value) return
  await run('score', async () => {
    await saveScoreValues()
    try {
      await api(`/api/matches/${selectedMatch.value!.id}/confirm`, json('POST', manualWinnerId ? { manualWinnerId } : {}))
      tiePending.value = false
      await loadTournament(selectedMatch.value!.tournamentId)
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
    notify('对局已重新打开')
  })
}

async function prepareBroadcast(channel: BroadcastChannel) {
  if (!activeTournament.value) return
  if (channel !== 'bracket' && !selectedMatch.value) return notify('请先选择一场对局', 'error')
  await run(`draft-${channel}`, async () => {
    const body = channel === 'bracket'
      ? { tournamentId: activeTournament.value!.id }
      : { matchId: selectedMatch.value!.id, songIds: channel === 'songs' ? chosenSongs.value.map((song) => song.id).filter(Boolean) : undefined }
    const state = await api<any>(`/api/broadcast/${channel}/draft`, json('PUT', body))
    broadcastRevision[channel] = state.revision
    const frame = document.querySelector<HTMLIFrameElement>(`#preview-${channel}`)
    if (frame) frame.src = `/obs/${channel}?preview=1&t=${Date.now()}`
    notify(`${channelLabel(channel)}预览已更新`)
  })
}

async function publish(channel: BroadcastChannel) {
  await run(`publish-${channel}`, async () => {
    const state = await api<any>(`/api/broadcast/${channel}/publish`, { method: 'POST' })
    broadcastRevision[channel] = state.revision
    notify(`${channelLabel(channel)}已推送到直播 · R${state.revision}`)
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
        <button v-for="item in sections" :key="item.id" :class="{ active: activeSection === item.id }" @click="activeSection = item.id">
          <span>{{ item.mark }}</span>{{ item.label }}
        </button>
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

      <section v-if="activeSection === 'overview'" class="page-section">
        <div class="hero-panel">
          <div>
            <span class="live-pill"><i></i> BROADCAST READY</span>
            <h2>把每一场对决<br><em>准确送上直播画面。</em></h2>
            <p>从两队入场、曲目揭晓到成绩确认和加赛安排，所有 OBS 页面由这里统一预览和推送。</p>
            <div class="hero-actions">
              <button class="primary" @click="activeSection = activeTournament ? 'match' : 'players'">{{ activeTournament ? '进入对局控制' : '从玩家名单开始' }} <span>→</span></button>
              <button class="ghost" @click="activeSection = 'broadcast'">检查播出源</button>
            </div>
          </div>
          <div class="hero-orbit"><div class="orbit-core">VS</div><i v-for="n in 8" :key="n" :style="{ transform: `rotate(${n * 45}deg)` }"></i></div>
        </div>
        <div class="metric-grid">
          <article><span>PLAYERS</span><strong>{{ players.length }}</strong><small>玩家库总人数</small></article>
          <article><span>LIVE MATCHES</span><strong>{{ liveMatchCount }}</strong><small>当前待进行对局</small></article>
          <article><span>PROGRESS</span><strong>{{ completedMatchCount }}</strong><small>已结算对战行</small></article>
          <article><span>SONG CACHE</span><strong>{{ songCache.count }}</strong><small>{{ songCache.updatedAt ? '本地曲库可用' : '等待首次同步' }}</small></article>
        </div>
        <div class="quick-grid">
          <button @click="activeSection = 'players'"><b>＋</b><span><strong>添加玩家</strong><small>姓名与自定义头像</small></span><i>→</i></button>
          <button @click="activeSection = 'tournament'"><b>⌘</b><span><strong>队伍与对战行</strong><small>自由分队并选择当前行</small></span><i>→</i></button>
          <button @click="activeSection = 'broadcast'"><b>◉</b><span><strong>推送直播</strong><small>预览确认后原子更新</small></span><i>→</i></button>
        </div>
      </section>

      <section v-else-if="activeSection === 'players'" class="page-section">
        <div class="section-heading"><div><span>PLAYER DATABASE</span><h2>玩家名单</h2><p>头像会被保存在本机，并在所有比赛快照中使用。</p></div><form class="inline-create" @submit.prevent="createPlayer"><input v-model="newPlayerName" maxlength="32" placeholder="输入新玩家名称" /><button class="primary" :disabled="busy === 'player'">＋ 添加玩家</button></form></div>
        <div v-if="players.length" class="player-grid">
          <article v-for="(player, index) in players" :key="player.id" class="player-card">
            <div class="avatar-wrap">
              <img v-if="player.avatarUrl" :src="player.avatarUrl" :alt="player.name" />
              <span v-else>{{ player.name.slice(0, 1).toUpperCase() }}</span>
              <label :aria-label="`编辑 ${player.name} 的头像`" title="点击头像编辑"><input type="file" accept="image/png,image/jpeg,image/webp" @change="uploadAvatar(player, $event)" /></label>
            </div>
            <div><small>PLAYER {{ String(players.length - index).padStart(2, '0') }}</small><h3>{{ player.name }}</h3><p>#{{ player.id }} · 已就绪</p></div>
            <div class="card-actions"><button @click="renamePlayer(player)">编辑</button><button class="danger" @click="deletePlayer(player)">删除</button></div>
          </article>
        </div>
        <div v-else class="empty-state"><div>01</div><h3>名单还是空的</h3><p>先添加至少两位玩家，之后就能创建第一场赛事。</p></div>
      </section>

      <section v-else-if="activeSection === 'tournament'" class="page-section">
        <div class="section-heading"><div><span>TEAM BATTLE BOARD</span><h2>队伍与对战行</h2><p>两边自由添加玩家；进入下一轮时由导播移除淘汰者，把队伍各自减半后重新排对战行。系统不会替你决定人选。</p></div>
          <div class="team-score-chip" v-if="teamBoard"><span :style="{ color: team1Color }">{{ team1Name }} {{ teamBoard.score.team1 }}</span><b>:</b><span :style="{ color: team2Color }">{{ teamBoard.score.team2 }} {{ team2Name }}</span></div>
        </div>
        <div class="team-config-grid">
          <article class="panel team-panel" :style="{ '--team-color': team1Color }">
            <div class="team-name-editor"><input type="color" v-model="team1Color" /><input v-model="team1Name" maxlength="18" /><span>{{ team1PlayerIds.length }} 人</span></div>
            <div class="team-member-list">
              <div v-for="id in team1PlayerIds" :key="id"><span class="mini-avatar"><img v-if="playerById(id)?.avatarUrl" :src="playerById(id)?.avatarUrl || ''" /><i v-else>{{ playerById(id)?.name?.[0] }}</i></span><b>{{ playerById(id)?.name }}</b><button @click="removePlayerFromTeam(1, id)">×</button></div>
              <p v-if="!team1PlayerIds.length">从玩家池加入左队队员</p>
            </div>
            <div class="team-add-row"><select v-model="addTeam1PlayerId"><option :value="null">选择玩家…</option><option v-for="player in availableForTeam1" :key="player.id" :value="player.id">{{ player.name }}</option></select><button @click="addPlayerToTeam(1)">＋ 加入</button></div>
          </article>
          <div class="team-config-center"><span>TEAM</span><strong>VS</strong><button :class="teamSettingsDirty ? 'primary save-dirty' : 'secondary'" :disabled="!teamSettingsDirty || busy === 'teams'" @click="saveTeamSettings">{{ teamSettingsDirty ? '保存修改' : '已保存' }}</button></div>
          <article class="panel team-panel right" :style="{ '--team-color': team2Color }">
            <div class="team-name-editor"><input type="color" v-model="team2Color" /><input v-model="team2Name" maxlength="18" /><span>{{ team2PlayerIds.length }} 人</span></div>
            <div class="team-member-list">
              <div v-for="id in team2PlayerIds" :key="id"><span class="mini-avatar"><img v-if="playerById(id)?.avatarUrl" :src="playerById(id)?.avatarUrl || ''" /><i v-else>{{ playerById(id)?.name?.[0] }}</i></span><b>{{ playerById(id)?.name }}</b><button @click="removePlayerFromTeam(2, id)">×</button></div>
              <p v-if="!team2PlayerIds.length">从玩家池加入右队队员</p>
            </div>
            <div class="team-add-row"><select v-model="addTeam2PlayerId"><option :value="null">选择玩家…</option><option v-for="player in availableForTeam2" :key="player.id" :value="player.id">{{ player.name }}</option></select><button @click="addPlayerToTeam(2)">＋ 加入</button></div>
          </article>
        </div>

        <article class="panel battle-rows-panel">
          <div class="panel-title row"><div><span>BATTLE ROWS</span><h3>对战行</h3></div><div class="battle-row-actions"><button class="secondary" @click="addTeamMatchRow(false)">＋ 普通行</button><button class="tiebreak-button" @click="addTeamMatchRow(true)">＋ 加赛行</button></div></div>
          <div class="battle-table-head"><span>行</span><b :style="{ color: team1Color }">{{ team1Name }} · 1P</b><i>对战</i><b :style="{ color: team2Color }">{{ team2Name }} · 2P</b><span>操作</span></div>
          <div class="battle-row" v-for="match in bracket?.matches || []" :key="match.id" :class="{ current: teamBoard?.currentMatchId === match.id, done: match.status === 'completed', tiebreak: match.isTiebreak }">
            <span class="battle-index">{{ match.isTiebreak ? '加赛' : String(match.matchIndex + 1).padStart(2, '0') }}</span>
            <select v-model="pairingDraft[match.id].player1Id" :disabled="match.status === 'completed' || Boolean(match.songs?.length)"><option :value="null">选择 {{ team1Name }} 玩家</option><option v-for="id in team1PlayerIds" :key="id" :value="id">{{ playerById(id)?.name }}</option></select>
            <div class="row-vs"><span>{{ match.status === 'completed' ? '已结束' : match.status === 'pending' ? 'READY' : 'VS' }}</span><b v-if="match.winnerId">WIN</b></div>
            <select v-model="pairingDraft[match.id].player2Id" :disabled="match.status === 'completed' || Boolean(match.songs?.length)"><option :value="null">选择 {{ team2Name }} 玩家</option><option v-for="id in team2PlayerIds" :key="id" :value="id">{{ playerById(id)?.name }}</option></select>
            <div class="row-buttons"><button :class="{ 'save-dirty': teamRowDirty(match) }" @click="saveTeamRow(match)" :disabled="!teamRowDirty(match) || match.status === 'completed' || Boolean(match.songs?.length)">{{ teamRowDirty(match) ? '保存修改' : '已保存' }}</button><button @click="setCurrentRow(match)" :class="{ live: teamBoard?.currentMatchId === match.id }">当前行</button><button class="danger" @click="deleteTeamMatchRow(match)" :disabled="match.status === 'completed' || Boolean(match.songs?.length)">×</button></div>
          </div>
          <div v-if="!bracket?.matches.length" class="small-empty">添加第一条对战行，然后从左右队伍中各选一名玩家。</div>
        </article>
      </section>

      <section v-else-if="activeSection === 'match'" class="page-section">
        <div class="section-heading"><div><span>MATCH DIRECTOR</span><h2>对局控制</h2><p>选择一条对战行，安排曲目并录入双方成绩。</p></div><div class="round-chip" v-if="selectedMatch">{{ matchLabel(selectedMatch) }}</div></div>
        <div v-if="!activeTournament" class="empty-state"><div>VS</div><h3>队伍面板正在初始化</h3><p>稍后重试即可。</p></div>
        <div v-else class="director-layout">
          <aside class="match-list panel">
            <div class="panel-title"><span>MATCH QUEUE</span><h3>对局队列</h3></div>
            <button v-for="match in pendingMatches" :key="match.id" :class="{ selected: selectedMatch?.id === match.id, done: match.status === 'completed' }" @click="selectMatch(match)">
              <i>{{ match.isTiebreak ? 'T' : match.matchIndex + 1 }}</i><span><b>{{ match.player1?.name || '待选择' }} <em>vs</em> {{ match.player2?.name || '待选择' }}</b><small>{{ matchLabel(match) }}</small></span><strong>{{ match.status === 'completed' ? '✓' : '→' }}</strong>
            </button>
            <p v-if="!pendingMatches.length" class="hint">没有可操作的对局。</p>
          </aside>
          <div v-if="selectedMatch?.player1 && selectedMatch.player2" class="match-workspace">
            <article class="versus-card">
              <div class="competitor p1"><span class="side-tag">{{ team1Name }} · 1P</span><div class="big-avatar"><img v-if="selectedMatch.player1?.avatarUrl" :src="selectedMatch.player1.avatarUrl" /><b v-else>{{ selectedMatch.player1?.name?.[0] }}</b></div><h3>{{ selectedMatch.player1?.name }}</h3><small v-if="selectedMatch.total1 != null">{{ selectedMatch.total1.toFixed(4) }}%</small></div>
              <div class="versus-center"><span>{{ matchLabel(selectedMatch) }}</span><strong>VS</strong><i :class="selectedMatch.status">{{ selectedMatch.status === 'completed' ? (selectedMatch.winnerId ? '已结算' : '本行平局') : '等待成绩' }}</i></div>
              <div class="competitor p2"><span class="side-tag">{{ team2Name }} · 2P</span><div class="big-avatar"><img v-if="selectedMatch.player2?.avatarUrl" :src="selectedMatch.player2.avatarUrl" /><b v-else>{{ selectedMatch.player2?.name?.[0] }}</b></div><h3>{{ selectedMatch.player2?.name }}</h3><small v-if="selectedMatch.total2 != null">{{ selectedMatch.total2.toFixed(4) }}%</small></div>
            </article>

            <article class="panel song-editor">
              <div class="panel-title row"><div><span>SET LIST</span><h3>本场曲目</h3></div><button class="small-button" @click="syncSongCache" :disabled="busy === 'sync'">↻ 同步曲库 · {{ songCache.count }}</button></div>
              <div v-if="selectedMatch.status !== 'completed'" class="song-search">
                <input v-model="songQuery" placeholder="搜索曲名、艺术家或别名…" />
                <div v-if="songResults.length" class="search-popover">
                  <article v-for="song in songResults" :key="song.id">
                    <img :src="`/api/songs/${song.id}/jacket`" />
                    <div><b>{{ song.title }}</b><small>{{ song.artist }}</small><p><button v-for="chart in flattenDifficulties(song)" :key="`${chart.type}-${chart.difficulty}`" class="chart-choice" :class="difficultyClass(chart.difficulty)" @click="addSong(song, chart)"><strong>{{ difficultyName(chart.difficulty) }}</strong><span>LV {{ chart.level }}</span><i>{{ chart.type.toUpperCase() }}</i></button></p></div>
                  </article>
                </div>
              </div>
              <div class="chosen-songs">
                <article v-for="(song, index) in chosenSongs" :key="`${song.songId}-${index}`">
                  <span class="song-number">{{ String(index + 1).padStart(2, '0') }}</span>
                  <img :src="song.jacketUrl" />
                  <div><b>{{ song.title }}</b><small>{{ song.artist }} · {{ song.chartType.toUpperCase() }}</small><span class="difficulty-line"><i class="difficulty-badge" :class="difficultyClass(song.levelIndex)">{{ difficultyName(song.levelIndex) }}</i><strong>LV {{ song.level }}</strong></span></div>
                  <select v-model="song.source" :disabled="selectedMatch.status === 'completed'"><option value="1p">1P 选曲</option><option value="2p">2P 选曲</option><option value="required">课题曲</option><option value="tiebreak">加赛曲</option></select>
                  <button v-if="selectedMatch.status !== 'completed'" class="icon-danger" @click="removeSong(index)">×</button>
                </article>
                <p v-if="!chosenSongs.length" class="hint">从上方搜索曲目并选择谱面。</p>
              </div>
              <button v-if="selectedMatch.status !== 'completed'" class="secondary wide" :disabled="!chosenSongs.length" @click="saveSongs">保存曲目配置</button>
            </article>

            <article class="panel score-editor" v-if="chosenSongs.length && chosenSongs.every(song => song.id)">
              <div class="panel-title row"><div><span>SCORE INPUT</span><h3>达成率录入</h3></div><small>范围 0.0000 – 101.0000%</small></div>
              <div class="score-table">
                <div class="score-head"><span>曲目</span><b class="p1-text">{{ selectedMatch.player1?.name }}</b><b class="p2-text">{{ selectedMatch.player2?.name }}</b></div>
                <div v-for="(song, index) in chosenSongs" :key="song.id" class="score-row">
                  <span><i>{{ index + 1 }}</i><b>{{ song.title }}</b><small>{{ sourceLabel(song.source) }} · <em class="difficulty-text" :class="difficultyClass(song.levelIndex)">{{ difficultyName(song.levelIndex) }}</em> · LV {{ song.level }}</small></span>
                  <label><input v-model="scoreDraft[`${song.id}-${selectedMatch.player1?.id}`]" type="number" min="0" max="101" step="0.0001" :disabled="selectedMatch.status === 'completed'" /><em>%</em></label>
                  <label><input v-model="scoreDraft[`${song.id}-${selectedMatch.player2?.id}`]" type="number" min="0" max="101" step="0.0001" :disabled="selectedMatch.status === 'completed'" /><em>%</em></label>
                </div>
              </div>
              <div v-if="tiePending" class="tie-alert"><span>!</span><div><b>总分完全相同</b><p>本行不会给任何队伍加分，请到“队伍与对战行”添加加赛行并重新选双方选手。</p></div></div>
              <button v-if="selectedMatch.status !== 'completed'" class="primary wide" @click="confirmResult()">保存成绩并确认本行赛果</button>
              <button v-else class="secondary wide" @click="reopenSelected">重新打开并修正赛果</button>
            </article>
          </div>
          <div v-else class="empty-state compact-empty"><div>VS</div><h3>这条对战行还没有双方选手</h3><p>请先到“队伍与对战行”中，从左右队伍各选择一名玩家并保存。</p><button class="primary" @click="activeSection = 'tournament'">前往编排</button></div>
        </div>
      </section>

      <section v-else-if="activeSection === 'broadcast'" class="page-section">
        <div class="section-heading"><div><span>OUTPUT CONTROL</span><h2>播出控制</h2><p>先更新预览，确认无误后再把完整快照推送到 OBS。</p></div><div class="selected-broadcast" v-if="selectedMatch">信号源：{{ selectedMatch.player1?.name }} vs {{ selectedMatch.player2?.name }}</div></div>
        <div class="broadcast-grid">
          <article v-for="channel in (['match','songs','results','bracket'] as BroadcastChannel[])" :key="channel" class="broadcast-card">
            <div class="broadcast-head"><div><span><i></i> {{ channel.toUpperCase() }} OUTPUT</span><h3>{{ channelLabel(channel) }}</h3></div><b>R{{ broadcastRevision[channel] || 0 }}</b></div>
            <div class="preview-frame"><iframe :id="`preview-${channel}`" :src="`/obs/${channel}?preview=1`" :title="`${channelLabel(channel)}预览`"></iframe><span>PREVIEW</span></div>
            <div class="broadcast-actions"><button class="secondary" @click="prepareBroadcast(channel)">更新预览</button><button class="primary" @click="publish(channel)">推送到直播</button></div>
            <div class="source-url"><code>{{ `${appOrigin}/obs/${channel}` }}</code><button @click="copyObsUrl(channel)">复制</button></div>
          </article>
        </div>
      </section>
    </main>

    <transition name="toast"><div v-if="toast" class="toast" :class="toast.kind"><i>{{ toast.kind === 'ok' ? '✓' : '!' }}</i>{{ toast.message }}</div></transition>
  </div>
</template>
