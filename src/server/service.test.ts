import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Db } from './db.js'
import { createDatabase, nextPowerOfTwo } from './db.js'
import {
  addTeamRow, confirmMatch, createTournament, getBracket, getMatch, getTeamBoard,
  publishBroadcast, reopenMatch, saveBroadcastDraft, saveMatchSongs, saveScores,
  setCurrentTeamRow, setTournamentSlots, updateTeamMembers, updateTeamRow,
  updateTeamSettings
} from './service.js'

let db: Db

function addPlayers(count: number) {
  const insert = db.prepare('INSERT INTO players(name) VALUES (?)')
  return Array.from({ length: count }, (_, index) => Number(insert.run(`玩家 ${index + 1}`).lastInsertRowid))
}

function sampleSong(position = 0) {
  return {
    position,
    songId: 100 + position,
    title: `测试曲目 ${position + 1}`,
    artist: 'TEST ARTIST',
    jacketUrl: '',
    chartType: 'dx' as const,
    levelIndex: 3,
    level: '13+',
    source: 'required' as const
  }
}

beforeEach(() => { db = createDatabase(':memory:') })
afterEach(() => db.close())

describe('淘汰树', () => {
  it('为 31 人创建 32 槽位并自动处理一个轮空', () => {
    const ids = addPlayers(31)
    const tournament = createTournament(db, '31 人测试赛', ids)
    expect(nextPowerOfTwo(31)).toBe(32)
    expect(tournament.bracketSize).toBe(32)

    const slots = [...ids, null]
    const bracket = setTournamentSlots(db, tournament.id, slots)
    expect(bracket.matches).toHaveLength(31)
    expect(bracket.matches.filter((match) => match.roundIndex === 0 && match.status === 'bye')).toHaveLength(1)
    expect(bracket.matches.find((match) => match.roundIndex === 0 && match.matchIndex === 15)?.winnerId).toBe(ids[30])
  })

  it('确认成绩后精确求和并把胜者推进下一轮', () => {
    const [first, second, third] = addPlayers(3)
    const tournament = createTournament(db, '三人赛', [first, second, third])
    const bracket = setTournamentSlots(db, tournament.id, [first, null, second, third])
    const played = bracket.matches.find((match) => match.roundIndex === 0 && match.matchIndex === 1)!
    saveMatchSongs(db, played.id, [sampleSong(0), sampleSong(1)])
    const withSongs = getMatch(db, played.id)
    saveScores(db, played.id, [
      { songId: withSongs.songs[0].id!, playerId: second, achievement: 100.1234 },
      { songId: withSongs.songs[0].id!, playerId: third, achievement: 99.9999 },
      { songId: withSongs.songs[1].id!, playerId: second, achievement: 98.0001 },
      { songId: withSongs.songs[1].id!, playerId: third, achievement: 98.0001 }
    ])
    const result = confirmMatch(db, played.id)
    expect(result.total1).toBe(198.1235)
    expect(result.total2).toBe(198)
    expect(result.winnerId).toBe(second)

    const final = getBracket(db, tournament.id).matches.find((match) => match.roundIndex === 1)!
    expect(final.status).toBe('pending')
    expect(final.player1?.id).toBe(first)
    expect(final.player2?.id).toBe(second)
  })

  it('平分时要求人工指定胜者', () => {
    const [first, second] = addPlayers(2)
    const tournament = createTournament(db, '平分测试', [first, second])
    const match = setTournamentSlots(db, tournament.id, [first, second]).matches[0]
    saveMatchSongs(db, match.id, [sampleSong()])
    const song = getMatch(db, match.id).songs[0]
    saveScores(db, match.id, [
      { songId: song.id!, playerId: first, achievement: 100 },
      { songId: song.id!, playerId: second, achievement: 100 }
    ])
    expect(() => confirmMatch(db, match.id)).toThrowError('总分相同，请手动指定晋级玩家')
    expect(confirmMatch(db, match.id, second).winnerId).toBe(second)
  })

  it('下游已有数据时保护赛果回滚', () => {
    const [first, second, third, fourth] = addPlayers(4)
    const tournament = createTournament(db, '回滚测试', [first, second, third, fourth])
    let bracket = setTournamentSlots(db, tournament.id, [first, second, third, fourth])
    for (const match of bracket.matches.filter((item) => item.roundIndex === 0)) {
      saveMatchSongs(db, match.id, [sampleSong()])
      const song = getMatch(db, match.id).songs[0]
      saveScores(db, match.id, [
        { songId: song.id!, playerId: match.player1!.id, achievement: 100 },
        { songId: song.id!, playerId: match.player2!.id, achievement: 99 }
      ])
      confirmMatch(db, match.id)
    }
    bracket = getBracket(db, tournament.id)
    const final = bracket.matches.find((match) => match.roundIndex === 1)!
    saveMatchSongs(db, final.id, [sampleSong()])
    const semifinal = bracket.matches.find((match) => match.roundIndex === 0)!
    expect(() => reopenMatch(db, semifinal.id, false)).toThrowError('后续对局已有内容，需要确认清除后再修改')
    expect(reopenMatch(db, semifinal.id, true).status).toBe('pending')
    expect(getMatch(db, final.id).songs).toHaveLength(0)
  })
})

describe('播出快照', () => {
  it('逐曲保存成绩时立即进入结果草稿，最后一曲完成后才结算胜者', () => {
    const [first, second] = addPlayers(2)
    const tournament = createTournament(db, '逐曲成绩测试', [first, second])
    const match = setTournamentSlots(db, tournament.id, [first, second]).matches[0]
    saveMatchSongs(db, match.id, [sampleSong(0), sampleSong(1)])
    const songs = getMatch(db, match.id).songs

    const partial = saveScores(db, match.id, [
      { songId: songs[0].id!, playerId: first, achievement: 100.1234 },
      { songId: songs[0].id!, playerId: second, achievement: 99.9876 }
    ])
    expect(partial.status).toBe('pending')
    expect(partial.total1).toBeNull()
    expect(partial.total2).toBeNull()
    expect(partial.winnerId).toBeNull()
    expect(partial.songs[0].score1).toBe(100.1234)
    expect(partial.songs[0].score2).toBe(99.9876)
    expect(partial.songs[1].score1).toBeNull()
    expect(partial.songs[1].score2).toBeNull()

    const draft = saveBroadcastDraft(db, 'results', { matchId: match.id })
    const draftMatch = (draft.draft as any).match
    expect(draftMatch.status).toBe('pending')
    expect(draftMatch.winnerId).toBeNull()
    expect(draftMatch.songs[0].score1).toBe(100.1234)
    expect(draftMatch.songs[1].score1).toBeNull()
    expect(() => confirmMatch(db, match.id)).toThrowError('请先完整录入每首曲目的双方成绩')

    const cleared = saveScores(db, match.id, [
      { songId: songs[0].id!, playerId: first, achievement: null },
      { songId: songs[0].id!, playerId: second, achievement: null }
    ])
    expect(cleared.songs[0].score1).toBeNull()
    expect(cleared.songs[0].score2).toBeNull()

    saveScores(db, match.id, [
      { songId: songs[0].id!, playerId: first, achievement: 100.1234 },
      { songId: songs[0].id!, playerId: second, achievement: 99.9876 },
      { songId: songs[1].id!, playerId: first, achievement: 98.5 },
      { songId: songs[1].id!, playerId: second, achievement: 98 }
    ])
    const completed = confirmMatch(db, match.id)
    expect(completed.status).toBe('completed')
    expect(completed.winnerId).toBe(first)
    expect(completed.total1).toBe(198.6234)
    expect(completed.total2).toBe(197.9876)
  })

  it('草稿与已发布内容互相隔离并增加 revision', () => {
    const [first, second] = addPlayers(2)
    const tournament = createTournament(db, '直播测试', [first, second])
    const match = setTournamentSlots(db, tournament.id, [first, second]).matches[0]
    const draft = saveBroadcastDraft(db, 'match', { matchId: match.id })
    expect(draft.draft).toBeTruthy()
    expect(draft.published).toBeNull()
    const published = publishBroadcast(db, 'match')
    expect(published.revision).toBe(1)
    expect((published.published as any).tournament.name).toBe('直播测试')
  })

  it('曲目快照保留第三首课题曲', () => {
    const [first, second] = addPlayers(2)
    const tournament = createTournament(db, '三曲直播测试', [first, second])
    const match = setTournamentSlots(db, tournament.id, [first, second]).matches[0]
    saveMatchSongs(db, match.id, [sampleSong(0), sampleSong(1), sampleSong(2)])
    const songs = getMatch(db, match.id).songs
    const draft = saveBroadcastDraft(db, 'songs', {
      matchId: match.id,
      songIds: songs.map((song) => song.id)
    })
    expect((draft.draft as any).match.songs).toHaveLength(3)
    expect((draft.draft as any).match.songs[2].source).toBe('required')
  })
})

describe('两队导播面板', () => {
  it('允许自由分队、自由安排对战行并选择当前行', () => {
    const [yellow1, yellow2, green1, green2] = addPlayers(4)
    let board = getTeamBoard(db)
    expect(board.matches).toHaveLength(1)
    expect(board.tournament.mode).toBe('teams')

    board = updateTeamSettings(db, {
      team1Name: '柠檬队',
      team1Color: '#ffd34e',
      team2Name: '薄荷队',
      team2Color: '#4ee89a'
    })
    expect(board.tournament.team1Name).toBe('柠檬队')

    board = updateTeamMembers(db, [yellow1, yellow2], [green1, green2])
    expect(board.members.team1.map((player) => player.id)).toEqual([yellow1, yellow2])
    expect(board.members.team2.map((player) => player.id)).toEqual([green1, green2])

    const firstRow = board.matches[0]
    board = updateTeamRow(db, firstRow.id, yellow2, green1)
    expect(board.matches[0].status).toBe('pending')
    expect(board.matches[0].player1?.id).toBe(yellow2)
    expect(board.matches[0].player2?.id).toBe(green1)

    const tiebreak = addTeamRow(db, true)
    board = updateTeamRow(db, tiebreak.id, yellow1, green2, true)
    board = setCurrentTeamRow(db, tiebreak.id)
    expect(board.currentMatchId).toBe(tiebreak.id)
    expect(board.matches.find((match) => match.id === tiebreak.id)?.isTiebreak).toBe(true)
  })

  it('平分行不强行指定胜者，也不给任何队伍加分', () => {
    const [left, right] = addPlayers(2)
    let board = getTeamBoard(db)
    board = updateTeamMembers(db, [left], [right])
    board = updateTeamRow(db, board.matches[0].id, left, right)
    const match = board.matches[0]
    saveMatchSongs(db, match.id, [sampleSong()])
    const song = getMatch(db, match.id).songs[0]
    saveScores(db, match.id, [
      { songId: song.id!, playerId: left, achievement: 100.1234 },
      { songId: song.id!, playerId: right, achievement: 100.1234 }
    ])

    const result = confirmMatch(db, match.id)
    expect(result.status).toBe('completed')
    expect(result.winnerId).toBeNull()
    expect(getTeamBoard(db).score).toEqual({ team1: 0, team2: 0 })
  })

  it('只按已确认行的胜者累计两队比分', () => {
    const [left, right] = addPlayers(2)
    let board = updateTeamMembers(db, [left], [right])
    board = updateTeamRow(db, board.matches[0].id, left, right)
    const match = board.matches[0]
    saveMatchSongs(db, match.id, [sampleSong()])
    const song = getMatch(db, match.id).songs[0]
    saveScores(db, match.id, [
      { songId: song.id!, playerId: left, achievement: 99.9999 },
      { songId: song.id!, playerId: right, achievement: 100 }
    ])
    confirmMatch(db, match.id)
    expect(getTeamBoard(db).score).toEqual({ team1: 0, team2: 1 })
  })
})
