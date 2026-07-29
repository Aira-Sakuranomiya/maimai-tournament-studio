<script setup lang="ts">
import { ref, toRefs } from 'vue'
import { useRouter } from 'vue-router'
import { useControlContext } from './context'

const router = useRouter()
const {
  selectedMatch, activeTournament, pendingMatches, team1Name, team2Name, chosenSongs, songCache,
  busy, songQuery, songResults, scoreDraft, tiePending, matchLabel, selectMatch, syncSongCache,
  flattenDifficulties, difficultyClass, difficultyName, addSong, removeSong, moveSong, saveSongs, sourceLabel,
  scoreProgress, scoreDirty, savePartialScores, confirmResult, reopenSelected
} = toRefs(useControlContext())

const draggedSongIndex = ref<number | null>(null)
const songDropTarget = ref<number | null>(null)

function beginSongDrag(event: DragEvent, index: number) {
  draggedSongIndex.value = index
  songDropTarget.value = index
  if (!event.dataTransfer) return
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', String(index))
}

function dropSong(index: number) {
  if (draggedSongIndex.value != null) moveSong.value(draggedSongIndex.value, index)
  endSongDrag()
}

function endSongDrag() {
  draggedSongIndex.value = null
  songDropTarget.value = null
}
</script>

<template>
  <section class="page-section">
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
            <article
              v-for="(song, index) in chosenSongs"
              :key="`${song.id || song.songId}-${index}`"
              :class="{ dragging: draggedSongIndex === index, 'drag-over': songDropTarget === index && draggedSongIndex !== index }"
              @dragenter.prevent="songDropTarget = index"
              @dragover.prevent
              @drop.prevent="dropSong(index)"
            >
              <div v-if="selectedMatch.status !== 'completed'" class="song-order-controls">
                <button
                  class="song-drag-handle"
                  draggable="true"
                  title="拖拽调整顺序"
                  :aria-label="`拖拽调整《${song.title}》的顺序`"
                  @dragstart="beginSongDrag($event, index)"
                  @dragend="endSongDrag"
                >⠿</button>
                <button class="song-move-button" :disabled="index === 0" @click="moveSong(index, index - 1)" aria-label="上移曲目">↑</button>
                <button class="song-move-button" :disabled="index === chosenSongs.length - 1" @click="moveSong(index, index + 1)" aria-label="下移曲目">↓</button>
              </div>
              <span class="song-number">{{ String(index + 1).padStart(2, '0') }}</span>
              <img :src="song.jacketUrl" />
              <div class="song-detail"><b>{{ song.title }}</b><small>{{ song.artist }} · {{ song.chartType.toUpperCase() }}</small><span class="difficulty-line"><i class="difficulty-badge" :class="difficultyClass(song.levelIndex)">{{ difficultyName(song.levelIndex) }}</i><strong>LV {{ song.level }}</strong></span></div>
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
          <div v-if="selectedMatch.status !== 'completed'" class="score-save-bar">
            <div><b>已录入 {{ scoreProgress.completed }} / {{ scoreProgress.total }} 首</b><small>每曲结束后先保存，成绩页预览会立即更新；全部完成后再结算胜负。</small></div>
            <div class="score-actions">
              <button class="secondary" :disabled="!scoreDirty || busy === 'score-save' || busy === 'score'" @click="savePartialScores">保存成绩修改</button>
              <button class="primary" :disabled="!scoreProgress.allComplete || busy === 'score-save' || busy === 'score'" @click="confirmResult()">确认最终赛果</button>
            </div>
          </div>
          <button v-else class="secondary wide" @click="reopenSelected">重新打开并修正赛果</button>
        </article>
      </div>
      <div v-else class="empty-state compact-empty"><div>VS</div><h3>这条对战行还没有双方选手</h3><p>请先到“队伍与对战行”中，从左右队伍各选择一名玩家并保存。</p><button class="primary" @click="router.push('/control/teams')">前往编排</button></div>
    </div>
  </section>
</template>
