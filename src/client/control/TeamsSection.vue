<script setup lang="ts">
import { toRefs } from 'vue'
import { useControlContext } from './context'

const {
  teamBoard, team1Name, team1Color, team2Name, team2Color, team1PlayerIds, team2PlayerIds,
  addTeam1PlayerId, addTeam2PlayerId, availableForTeam1, availableForTeam2, teamSettingsDirty,
  busy, bracket, pairingDraft, playerById, saveTeamSettings, addPlayerToTeam, removePlayerFromTeam,
  addTeamMatchRow, teamRowDirty, saveTeamRow, setCurrentRow, deleteTeamMatchRow
} = toRefs(useControlContext())
</script>

<template>
  <section class="page-section">
    <div class="section-heading">
      <div><span>TEAM BATTLE BOARD</span><h2>队伍与对战行</h2><p>两边自由添加玩家；进入下一轮时由导播移除淘汰者，把队伍各自减半后重新排对战行。系统不会替你决定人选。</p></div>
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
</template>
