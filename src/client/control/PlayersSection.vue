<script setup lang="ts">
import { toRefs } from 'vue'
import { useControlContext } from './context'

const {
  players, newPlayerName, busy, createPlayer, uploadAvatar, renamePlayer, deletePlayer
} = toRefs(useControlContext())
</script>

<template>
  <section class="page-section">
    <div class="section-heading">
      <div><span>PLAYER DATABASE</span><h2>玩家名单</h2><p>头像会被保存在本机，并在所有比赛快照中使用。</p></div>
      <form class="inline-create" @submit.prevent="createPlayer">
        <input v-model="newPlayerName" maxlength="32" placeholder="输入新玩家名称" />
        <button class="primary" :disabled="busy === 'player'">＋ 添加玩家</button>
      </form>
    </div>
    <div v-if="players.length" class="player-grid">
      <article v-for="(player, index) in players" :key="player.id" class="player-card">
        <div class="avatar-wrap">
          <img v-if="player.avatarUrl" :src="player.avatarUrl" :alt="player.name" />
          <span v-else>{{ player.name.slice(0, 1).toUpperCase() }}</span>
          <label :aria-label="`编辑 ${player.name} 的头像`" title="点击头像编辑">
            <input type="file" accept="image/png,image/jpeg,image/webp" @change="uploadAvatar(player, $event)" />
          </label>
        </div>
        <div><small>PLAYER {{ String(players.length - index).padStart(2, '0') }}</small><h3>{{ player.name }}</h3><p>#{{ player.id }} · 已就绪</p></div>
        <div class="card-actions"><button @click="renamePlayer(player)">编辑</button><button class="danger" @click="deletePlayer(player)">删除</button></div>
      </article>
    </div>
    <div v-else class="empty-state"><div>01</div><h3>名单还是空的</h3><p>先添加至少两位玩家，之后就能创建第一场赛事。</p></div>
  </section>
</template>
