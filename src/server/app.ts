import Fastify, { type FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import { Server as SocketServer } from 'socket.io'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { createDatabase, type Db } from './db.js'
import { JACKET_DIR, UPLOAD_DIR } from './config.js'
import {
  addTeamRow, confirmMatch, createTournament, deleteTeamRow, getBracket, getBroadcastState, getMatch,
  getSongCacheInfo, getTeamBoard, getTournament, jacketSourceUrl, listPlayers, listTournaments,
  refreshBroadcastChannels, reopenMatch, resetTeamBoard, saveBroadcastSnapshot, saveMatchSongs, saveScores,
  searchSongs, setBracketPairings, setCurrentTeamRow, setTournamentSlots, syncSongs, updateTeamMembers,
  updateTeamRow, updateTeamSettings
} from './service.js'
import type { BroadcastChannel } from '../shared/types.js'

const channels = new Set(['match', 'songs', 'results', 'bracket'])

export async function buildApp(options: { database?: string } = {}): Promise<{ app: FastifyInstance; db: Db; io: SocketServer }> {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' })
  const db = createDatabase(options.database)
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } })
  const io = new SocketServer(app.server, { cors: { origin: true } })

  app.addHook('onClose', async () => {
    io.close()
    db.close()
  })

  app.get('/api/health', async () => ({ ok: true }))
  app.get('/api/team-board', async () => getTeamBoard(db))
  app.put('/api/team-board/settings', async (request) => updateTeamSettings(db, request.body as any))
  app.put('/api/team-board/members', async (request) => {
    const body = request.body as { team1PlayerIds?: number[]; team2PlayerIds?: number[] }
    return updateTeamMembers(db, body.team1PlayerIds || [], body.team2PlayerIds || [])
  })
  app.post('/api/team-board/rows', async (request, reply) => reply.code(201).send(addTeamRow(db, Boolean((request.body as any)?.isTiebreak))))
  app.put('/api/team-board/rows/:id', async (request) => {
    const body = request.body as { player1Id?: number | null; player2Id?: number | null; isTiebreak?: boolean }
    return updateTeamRow(db, Number((request.params as any).id), body.player1Id ?? null, body.player2Id ?? null, body.isTiebreak)
  })
  app.delete('/api/team-board/rows/:id', async (request) => deleteTeamRow(db, Number((request.params as any).id)))
  app.post('/api/team-board/current/:id', async (request) => setCurrentTeamRow(db, Number((request.params as any).id)))
  app.post('/api/team-board/reset', async () => resetTeamBoard(db))

  app.get('/api/players', async () => listPlayers(db))
  app.post('/api/players', async (request, reply) => {
    const body = request.body as { name?: string }
    if (!body?.name?.trim()) return reply.code(400).send({ message: '请输入玩家名称' })
    const result = db.prepare('INSERT INTO players(name) VALUES (?)').run(body.name.trim())
    return reply.code(201).send(listPlayers(db).find((player) => player!.id === Number(result.lastInsertRowid)))
  })
  app.patch('/api/players/:id', async (request, reply) => {
    const id = Number((request.params as any).id)
    const body = request.body as { name?: string }
    if (!body?.name?.trim()) return reply.code(400).send({ message: '请输入玩家名称' })
    const result = db.prepare('UPDATE players SET name = ? WHERE id = ?').run(body.name.trim(), id)
    if (!result.changes) return reply.code(404).send({ message: '玩家不存在' })
    db.prepare(`
      UPDATE tournament_participants SET name_snapshot = ?
      WHERE player_id = ? AND tournament_id IN (SELECT id FROM tournaments WHERE active = 1)
    `).run(body.name.trim(), id)
    return listPlayers(db).find((player) => player!.id === id)
  })
  app.post('/api/players/:id/avatar', async (request, reply) => {
    const id = Number((request.params as any).id)
    const file = await request.file()
    if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) return reply.code(400).send({ message: '仅支持 PNG、JPEG 或 WebP 图片' })
    const extension = file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg'
    const filename = `${id}-${crypto.randomUUID()}.${extension}`
    await pipeline(file.file, fs.createWriteStream(path.join(UPLOAD_DIR, filename)))
    const previous = db.prepare('SELECT avatar_path FROM players WHERE id = ?').get(id) as { avatar_path?: string } | undefined
    if (!previous) return reply.code(404).send({ message: '玩家不存在' })
    db.prepare('UPDATE players SET avatar_path = ? WHERE id = ?').run(filename, id)
    db.prepare(`
      UPDATE tournament_participants SET avatar_snapshot = ?
      WHERE player_id = ? AND tournament_id IN (SELECT id FROM tournaments WHERE active = 1)
    `).run(filename, id)
    if (previous.avatar_path) fs.rm(path.join(UPLOAD_DIR, previous.avatar_path), { force: true }, () => {})
    return listPlayers(db).find((player) => player!.id === id)
  })
  app.delete('/api/players/:id', async (request, reply) => {
    const id = Number((request.params as any).id)
    const used = db.prepare('SELECT 1 FROM tournament_participants WHERE player_id = ? LIMIT 1').get(id)
    if (used) return reply.code(409).send({ message: '该玩家已被赛事引用，不能删除' })
    const row = db.prepare('SELECT avatar_path FROM players WHERE id = ?').get(id) as { avatar_path?: string } | undefined
    const result = db.prepare('DELETE FROM players WHERE id = ?').run(id)
    if (!result.changes) return reply.code(404).send({ message: '玩家不存在' })
    if (row?.avatar_path) fs.rm(path.join(UPLOAD_DIR, row.avatar_path), { force: true }, () => {})
    return reply.code(204).send()
  })

  app.get('/api/tournaments', async () => listTournaments(db))
  app.get('/api/tournaments/:id', async (request) => getTournament(db, Number((request.params as any).id)))
  app.post('/api/tournaments', async (request, reply) => {
    const body = request.body as { name?: string; playerIds?: number[] }
    return reply.code(201).send(createTournament(db, body.name, body.playerIds || []))
  })
  app.post('/api/tournaments/:id/activate', async (request) => {
    const id = Number((request.params as any).id)
    getTournament(db, id)
    db.transaction(() => {
      db.prepare('UPDATE tournaments SET active = 0').run()
      db.prepare('UPDATE tournaments SET active = 1 WHERE id = ?').run(id)
    })()
    return getTournament(db, id)
  })
  app.put('/api/tournaments/:id/slots', async (request) => {
    const id = Number((request.params as any).id)
    return setTournamentSlots(db, id, (request.body as { slots?: Array<number | null> }).slots || [])
  })
  app.get('/api/tournaments/:id/bracket', async (request) => getBracket(db, Number((request.params as any).id)))
  app.put('/api/tournaments/:id/bracket', async (request) => {
    const id = Number((request.params as any).id)
    return setBracketPairings(db, id, (request.body as any).pairings || [])
  })

  app.get('/api/matches/:id', async (request) => getMatch(db, Number((request.params as any).id)))
  app.put('/api/matches/:id/songs', async (request) => saveMatchSongs(db, Number((request.params as any).id), (request.body as any).songs || []))
  app.put('/api/matches/:id/scores', async (request) => saveScores(db, Number((request.params as any).id), (request.body as any).scores || []))
  app.post('/api/matches/:id/confirm', async (request) => confirmMatch(db, Number((request.params as any).id), (request.body as any)?.manualWinnerId))
  app.post('/api/matches/:id/reopen', async (request) => reopenMatch(db, Number((request.params as any).id), Boolean((request.body as any)?.clearDownstream)))

  app.get('/api/songs/cache', async () => getSongCacheInfo(db))
  app.post('/api/songs/sync', async () => syncSongs(db))
  app.get('/api/songs/search', async (request) => {
    const query = String((request.query as any).q || '')
    return query.trim() ? searchSongs(db, query) : []
  })
  app.get('/api/songs/:id/jacket', async (request, reply) => {
    const songId = Number((request.params as any).id)
    if (!Number.isInteger(songId)) return reply.code(400).send({ message: '曲目 ID 无效' })
    const localPath = path.join(JACKET_DIR, `${songId}.png`)
    if (fs.existsSync(localPath)) return reply.type('image/png').send(fs.createReadStream(localPath))
    const response = await fetch(jacketSourceUrl(songId))
    if (!response.ok) return reply.code(502).send({ message: '曲绘加载失败' })
    const buffer = Buffer.from(await response.arrayBuffer())
    await fs.promises.writeFile(localPath, buffer)
    return reply.type('image/png').send(buffer)
  })

  app.post('/api/broadcast/refresh', async (request, reply) => {
    const requested = (request.body as { channels?: BroadcastChannel[] })?.channels || []
    if (!requested.length || requested.some((channel) => !channels.has(channel))) {
      return reply.code(400).send({ message: '请选择需要同步的直播频道' })
    }
    const states = refreshBroadcastChannels(db, requested)
    for (const state of states) {
      io.emit('broadcast:update', { channel: state.channel, data: state.published })
    }
    return { states }
  })
  app.get('/api/broadcast/:channel', async (request, reply) => {
    const channel = (request.params as any).channel as BroadcastChannel
    if (!channels.has(channel)) return reply.code(404).send({ message: '播出频道不存在' })
    return getBroadcastState(db, channel)
  })
  app.put('/api/broadcast/:channel', async (request, reply) => {
    const channel = (request.params as any).channel as BroadcastChannel
    if (!channels.has(channel)) return reply.code(404).send({ message: '播出频道不存在' })
    const state = saveBroadcastSnapshot(db, channel, request.body as any)
    io.emit('broadcast:update', { channel, data: state.published })
    return state
  })

  await app.register(fastifyStatic, { root: UPLOAD_DIR, prefix: '/uploads/' })
  const dist = path.resolve('dist')
  if (fs.existsSync(dist)) {
    await app.register(fastifyStatic, { root: dist, prefix: '/', decorateReply: false })
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) return reply.code(404).send({ message: '接口不存在' })
      return reply.type('text/html').send(fs.createReadStream(path.join(dist, 'index.html')))
    })
  }

  app.setErrorHandler((error: any, _request, reply) => {
    if (reply.sent) return
    reply.code(error.statusCode || 500).send({ message: error.message || '服务器内部错误', code: error.code })
  })
  return { app, db, io }
}
