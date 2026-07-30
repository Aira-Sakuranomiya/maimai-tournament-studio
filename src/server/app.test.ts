import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app.js'

let app: FastifyInstance

beforeEach(async () => {
  app = (await buildApp({ database: ':memory:' })).app
})
afterEach(async () => app.close())

describe('REST API 流程', () => {
  it('通过两队面板自由选人、编排行并切换当前行', async () => {
    const players = []
    for (const name of ['YELLOW ACE', 'YELLOW B', 'GREEN ACE', 'GREEN B']) {
      players.push((await app.inject({ method: 'POST', url: '/api/players', payload: { name } })).json())
    }

    const configured = await app.inject({
      method: 'PUT',
      url: '/api/team-board/members',
      payload: {
        team1PlayerIds: [players[0].id, players[1].id],
        team2PlayerIds: [players[2].id, players[3].id]
      }
    })
    expect(configured.statusCode).toBe(200)
    const firstRow = configured.json().matches[0]

    const arranged = await app.inject({
      method: 'PUT',
      url: `/api/team-board/rows/${firstRow.id}`,
      payload: { player1Id: players[1].id, player2Id: players[2].id }
    })
    expect(arranged.json().matches[0].player1.name).toBe('YELLOW B')
    expect(arranged.json().matches[0].player2.name).toBe('GREEN ACE')

    const synced = await app.inject({
      method: 'POST',
      url: '/api/broadcast/refresh',
      payload: { channels: ['match', 'bracket'] }
    })
    expect(synced.statusCode).toBe(200)
    expect(synced.json().states.map((state: any) => state.channel)).toEqual(['match', 'bracket'])
    expect(synced.json().states[0].published.match.player2.name).toBe('GREEN ACE')

    await app.inject({
      method: 'PATCH',
      url: `/api/players/${players[2].id}`,
      payload: { name: 'GREEN STAR' }
    })
    const playerSynced = await app.inject({
      method: 'POST',
      url: '/api/broadcast/refresh',
      payload: { channels: ['match'] }
    })
    expect(playerSynced.json().states[0].published.match.player2.name).toBe('GREEN STAR')

    const tiebreak = await app.inject({
      method: 'POST',
      url: '/api/team-board/rows',
      payload: { isTiebreak: true }
    })
    expect(tiebreak.statusCode).toBe(201)
    expect(tiebreak.json().isTiebreak).toBe(true)

    const selected = await app.inject({
      method: 'POST',
      url: `/api/team-board/current/${tiebreak.json().id}`
    })
    expect(selected.json().currentMatchId).toBe(tiebreak.json().id)
  })

  it('快速清空本轮并重新开始', async () => {
    const players = []
    for (const name of ['YELLOW A', 'YELLOW B', 'GREEN A', 'GREEN B']) {
      players.push((await app.inject({ method: 'POST', url: '/api/players', payload: { name } })).json())
    }
    const configured = await app.inject({
      method: 'PUT',
      url: '/api/team-board/members',
      payload: {
        team1PlayerIds: [players[0].id, players[1].id],
        team2PlayerIds: [players[2].id, players[3].id]
      }
    })
    const reset = await app.inject({
      method: 'POST',
      url: '/api/team-board/reset'
    })

    expect(reset.statusCode).toBe(200)
    expect(reset.json().tournament.participantIds).toEqual([])
    expect(reset.json().members).toEqual({ team1: [], team2: [] })
    expect(reset.json().matches).toHaveLength(1)
    expect(reset.json().matches[0].status).toBe('locked')
  })

  it('创建玩家、赛事、对阵并发布 OBS 快照', async () => {
    const first = await app.inject({ method: 'POST', url: '/api/players', payload: { name: 'ALPHA' } })
    const second = await app.inject({ method: 'POST', url: '/api/players', payload: { name: 'BETA' } })
    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(201)
    const firstId = first.json().id
    const secondId = second.json().id

    const created = await app.inject({
      method: 'POST',
      url: '/api/tournaments',
      payload: { name: 'API 测试赛', playerIds: [firstId, secondId] }
    })
    expect(created.statusCode).toBe(201)
    const tournamentId = created.json().id

    const arranged = await app.inject({
      method: 'PUT',
      url: `/api/tournaments/${tournamentId}/slots`,
      payload: { slots: [firstId, secondId] }
    })
    expect(arranged.statusCode).toBe(200)
    const matchId = arranged.json().matches[0].id

    const preview = await app.inject({
      method: 'PUT',
      url: '/api/broadcast/match/draft',
      payload: { matchId }
    })
    expect(preview.json().published).toBeNull()
    const live = await app.inject({ method: 'POST', url: '/api/broadcast/match/publish' })
    expect(live.json().revision).toBe(1)
    expect(live.json().published.match.player1.name).toBe('ALPHA')
  })

  it('阻止删除已被赛事引用的玩家', async () => {
    const players = []
    for (const name of ['ONE', 'TWO']) {
      players.push((await app.inject({ method: 'POST', url: '/api/players', payload: { name } })).json())
    }
    await app.inject({ method: 'POST', url: '/api/tournaments', payload: { name: '引用测试', playerIds: players.map((player) => player.id) } })
    const response = await app.inject({ method: 'DELETE', url: `/api/players/${players[0].id}` })
    expect(response.statusCode).toBe(409)
  })
})
