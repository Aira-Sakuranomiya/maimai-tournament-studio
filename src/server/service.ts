import type { Db } from './db.js'
import { nextPowerOfTwo } from './db.js'
import { LXNS_API_BASE, LXNS_ASSET_BASE } from './config.js'
import type { BroadcastChannel, MatchSong, SongSearchResult } from '../shared/types.js'

type AnyRow = Record<string, any>
const terminalStatuses = new Set(['completed', 'bye'])

function avatarUrl(path: string | null): string | null {
  return path ? `/uploads/${path}` : null
}

export function mapPlayer(row: AnyRow | undefined | null) {
  if (!row?.id) return null
  return {
    id: Number(row.id),
    name: String(row.name),
    avatarUrl: avatarUrl(row.avatar_path ?? null),
    createdAt: row.created_at ?? ''
  }
}

export function listPlayers(db: Db) {
  return db.prepare('SELECT * FROM players ORDER BY id DESC').all().map((row) => mapPlayer(row as AnyRow))
}

export function createTournament(db: Db, name: string | undefined, playerIds: number[]) {
  const unique = [...new Set(playerIds.map(Number))]
  if (unique.length < 2) throw Object.assign(new Error('赛事至少需要两名玩家'), { statusCode: 400 })
  const rows = db.prepare(`SELECT * FROM players WHERE id IN (${unique.map(() => '?').join(',')})`).all(...unique) as AnyRow[]
  if (rows.length !== unique.length) throw Object.assign(new Error('参赛玩家不存在'), { statusCode: 400 })
  const bracketSize = nextPowerOfTwo(unique.length)
  const create = db.transaction(() => {
    db.prepare('UPDATE tournaments SET active = 0').run()
    const result = db.prepare('INSERT INTO tournaments(name, bracket_size, active) VALUES (?, ?, 1)').run(name?.trim() || '淘汰赛', bracketSize)
    const tournamentId = Number(result.lastInsertRowid)
    const participantInsert = db.prepare(`
      INSERT INTO tournament_participants(tournament_id, player_id, name_snapshot, avatar_snapshot)
      VALUES (?, ?, ?, ?)
    `)
    for (const row of rows) participantInsert.run(tournamentId, row.id, row.name, row.avatar_path)
    const slotInsert = db.prepare('INSERT INTO bracket_slots(tournament_id, slot_index, player_id) VALUES (?, ?, NULL)')
    for (let index = 0; index < bracketSize; index++) slotInsert.run(tournamentId, index)
    const matchInsert = db.prepare(`
      INSERT INTO matches(tournament_id, round_index, match_index) VALUES (?, ?, ?)
    `)
    const rounds = Math.log2(bracketSize)
    for (let round = 0; round < rounds; round++) {
      const count = bracketSize / 2 ** (round + 1)
      for (let match = 0; match < count; match++) matchInsert.run(tournamentId, round, match)
    }
    return tournamentId
  })
  return getTournament(db, create())
}

export function listTournaments(db: Db) {
  return (db.prepare('SELECT * FROM tournaments ORDER BY id DESC').all() as AnyRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    bracketSize: row.bracket_size,
    active: Boolean(row.active),
    status: row.status,
    mode: row.mode,
    team1Name: row.team1_name,
    team1Color: row.team1_color,
    team2Name: row.team2_name,
    team2Color: row.team2_color,
    currentMatchId: row.current_match_id ?? null,
    createdAt: row.created_at
  }))
}

export function getTournament(db: Db, id: number) {
  const row = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id) as AnyRow | undefined
  if (!row) throw Object.assign(new Error('赛事不存在'), { statusCode: 404 })
  const participantIds = (db.prepare('SELECT player_id FROM tournament_participants WHERE tournament_id = ? ORDER BY rowid').all(id) as AnyRow[]).map((item) => item.player_id)
  const slots = (db.prepare('SELECT player_id FROM bracket_slots WHERE tournament_id = ? ORDER BY slot_index').all(id) as AnyRow[]).map((item) => item.player_id ?? null)
  return {
    id: row.id,
    name: row.name,
    bracketSize: row.bracket_size,
    active: Boolean(row.active),
    status: row.status,
    mode: row.mode,
    team1Name: row.team1_name,
    team1Color: row.team1_color,
    team2Name: row.team2_name,
    team2Color: row.team2_color,
    currentMatchId: row.current_match_id ?? null,
    createdAt: row.created_at,
    participantIds,
    slots
  }
}

function refreshFutureMatches(db: Db, tournamentId: number) {
  const tournament = getTournament(db, tournamentId)
  const rounds = Math.log2(tournament.bracketSize)
  for (let round = 1; round < rounds; round++) {
    const count = tournament.bracketSize / 2 ** (round + 1)
    for (let index = 0; index < count; index++) {
      const current = db.prepare('SELECT * FROM matches WHERE tournament_id = ? AND round_index = ? AND match_index = ?').get(tournamentId, round, index) as AnyRow
      if (current.status === 'completed') continue
      if (current.manual_pairing) continue
      const feeders = db.prepare(`
        SELECT * FROM matches WHERE tournament_id = ? AND round_index = ? AND match_index IN (?, ?) ORDER BY match_index
      `).all(tournamentId, round - 1, index * 2, index * 2 + 1) as AnyRow[]
      if (feeders.length !== 2 || !feeders.every((match) => terminalStatuses.has(match.status))) {
        db.prepare(`UPDATE matches SET player1_id = NULL, player2_id = NULL, winner_id = NULL, status = 'locked', total1 = NULL, total2 = NULL WHERE id = ?`).run(current.id)
        continue
      }
      const first = feeders[0].winner_id ?? null
      const second = feeders[1].winner_id ?? null
      if (first && second) {
        db.prepare(`UPDATE matches SET player1_id = ?, player2_id = ?, winner_id = NULL, status = 'pending', total1 = NULL, total2 = NULL WHERE id = ?`).run(first, second, current.id)
      } else {
        const winner = first || second || null
        db.prepare(`UPDATE matches SET player1_id = ?, player2_id = NULL, winner_id = ?, status = 'bye', total1 = NULL, total2 = NULL WHERE id = ?`).run(winner, winner, current.id)
      }
    }
  }
  const final = db.prepare('SELECT * FROM matches WHERE tournament_id = ? ORDER BY round_index DESC LIMIT 1').get(tournamentId) as AnyRow
  if (terminalStatuses.has(final.status) && final.winner_id) {
    db.prepare(`UPDATE tournaments SET status = 'completed' WHERE id = ?`).run(tournamentId)
  }
}

export function setTournamentSlots(db: Db, tournamentId: number, slots: Array<number | null>) {
  const tournament = getTournament(db, tournamentId)
  if (slots.length !== tournament.bracketSize) throw Object.assign(new Error('槽位数量不正确'), { statusCode: 400 })
  const assigned = slots.filter((id): id is number => Number.isInteger(id)).map(Number)
  if (new Set(assigned).size !== assigned.length) throw Object.assign(new Error('同一玩家不能占用多个槽位'), { statusCode: 400 })
  if (assigned.length !== tournament.participantIds.length || assigned.some((id) => !tournament.participantIds.includes(id))) {
    throw Object.assign(new Error('必须为所有参赛玩家各安排一个槽位'), { statusCode: 400 })
  }
  const started = db.prepare(`
    SELECT 1 FROM matches m LEFT JOIN match_songs s ON s.match_id = m.id
    WHERE m.tournament_id = ? AND (m.status = 'completed' OR s.id IS NOT NULL) LIMIT 1
  `).get(tournamentId)
  if (started) throw Object.assign(new Error('已有对局开始，不能重新安排首轮'), { statusCode: 409 })

  db.transaction(() => {
    const updateSlot = db.prepare('UPDATE bracket_slots SET player_id = ? WHERE tournament_id = ? AND slot_index = ?')
    slots.forEach((playerId, index) => updateSlot.run(playerId, tournamentId, index))
    db.prepare(`UPDATE matches SET player1_id = NULL, player2_id = NULL, winner_id = NULL, status = 'locked', total1 = NULL, total2 = NULL, manual_winner = 0, manual_pairing = 0 WHERE tournament_id = ?`).run(tournamentId)
    const firstRoundCount = tournament.bracketSize / 2
    for (let index = 0; index < firstRoundCount; index++) {
      const player1 = slots[index * 2] ?? null
      const player2 = slots[index * 2 + 1] ?? null
      if (player1 && player2) {
        db.prepare(`UPDATE matches SET player1_id = ?, player2_id = ?, status = 'pending', manual_pairing = 1 WHERE tournament_id = ? AND round_index = 0 AND match_index = ?`).run(player1, player2, tournamentId, index)
      } else {
        const winner = player1 || player2 || null
        db.prepare(`UPDATE matches SET player1_id = ?, player2_id = NULL, winner_id = ?, status = 'bye', manual_pairing = 1 WHERE tournament_id = ? AND round_index = 0 AND match_index = ?`).run(winner, winner, tournamentId, index)
      }
    }
    db.prepare(`UPDATE tournaments SET status = 'running' WHERE id = ?`).run(tournamentId)
    refreshFutureMatches(db, tournamentId)
  })()
  return getBracket(db, tournamentId)
}

export function setBracketPairings(
  db: Db,
  tournamentId: number,
  pairings: Array<{ matchId: number; player1Id: number | null; player2Id: number | null }>
) {
  const tournament = getTournament(db, tournamentId)
  const rows = db.prepare('SELECT * FROM matches WHERE tournament_id = ? ORDER BY round_index, match_index').all(tournamentId) as AnyRow[]
  const rowsById = new Map(rows.map((row) => [Number(row.id), row]))
  const requested = new Map<number, { player1Id: number | null; player2Id: number | null }>()

  for (const pairing of pairings) {
    const row = rowsById.get(Number(pairing.matchId))
    if (!row) throw Object.assign(new Error('对阵中包含不属于当前赛事的场次'), { statusCode: 400 })
    const player1Id = pairing.player1Id == null ? null : Number(pairing.player1Id)
    const player2Id = pairing.player2Id == null ? null : Number(pairing.player2Id)
    if (player1Id && !tournament.participantIds.includes(player1Id)) throw Object.assign(new Error('1P 不在当前参赛名单中'), { statusCode: 400 })
    if (player2Id && !tournament.participantIds.includes(player2Id)) throw Object.assign(new Error('2P 不在当前参赛名单中'), { statusCode: 400 })
    if (player1Id && player1Id === player2Id) throw Object.assign(new Error('同一场对局不能选择同一位玩家'), { statusCode: 400 })
    requested.set(row.id, { player1Id, player2Id })
  }

  for (const row of rows) {
    const next = requested.get(row.id) || { player1Id: row.player1_id ?? null, player2Id: row.player2_id ?? null }
    const changed = next.player1Id !== (row.player1_id ?? null) || next.player2Id !== (row.player2_id ?? null)
    if (!changed) continue
    const hasContent = db.prepare('SELECT 1 FROM match_songs WHERE match_id = ? LIMIT 1').get(row.id)
    if (row.status === 'completed' || hasContent) {
      throw Object.assign(new Error(`第 ${row.round_index + 1} 轮第 ${row.match_index + 1} 场已有曲目或成绩，请先在对局控制中重新打开`), { statusCode: 409 })
    }
  }

  const rounds = Math.log2(tournament.bracketSize)
  for (let round = 0; round < rounds; round++) {
    const selected: number[] = []
    for (const row of rows.filter((item) => item.round_index === round)) {
      const next = requested.get(row.id) || { player1Id: row.player1_id ?? null, player2Id: row.player2_id ?? null }
      if (next.player1Id) selected.push(next.player1Id)
      if (next.player2Id) selected.push(next.player2Id)
    }
    if (new Set(selected).size !== selected.length) {
      throw Object.assign(new Error(`第 ${round + 1} 轮中同一位玩家不能重复出场`), { statusCode: 400 })
    }
    if (round === 0) {
      const expected = [...tournament.participantIds].sort((a, b) => a - b)
      const actual = [...selected].sort((a, b) => a - b)
      if (actual.length !== expected.length || actual.some((id, index) => id !== expected[index])) {
        throw Object.assign(new Error('第一轮必须为每位参赛玩家各安排一次，空位将自动作为轮空'), { statusCode: 400 })
      }
    }
  }

  db.transaction(() => {
    for (const [matchId, next] of requested) {
      const row = rowsById.get(matchId)!
      const current1 = row.player1_id ?? null
      const current2 = row.player2_id ?? null
      if (next.player1Id === current1 && next.player2Id === current2) continue
      let status = 'locked'
      let winnerId: number | null = null
      if (next.player1Id && next.player2Id) {
        status = 'pending'
      } else if (row.round_index === 0 && (next.player1Id || next.player2Id)) {
        status = 'bye'
        winnerId = next.player1Id || next.player2Id
      }
      db.prepare(`
        UPDATE matches
        SET player1_id = ?, player2_id = ?, winner_id = ?, status = ?, total1 = NULL, total2 = NULL,
            manual_winner = 0, manual_pairing = 1
        WHERE id = ?
      `).run(next.player1Id, next.player2Id, winnerId, status, matchId)
      if (row.round_index === 0) {
        const firstSlot = row.match_index * 2
        db.prepare('UPDATE bracket_slots SET player_id = ? WHERE tournament_id = ? AND slot_index = ?').run(next.player1Id, tournamentId, firstSlot)
        db.prepare('UPDATE bracket_slots SET player_id = ? WHERE tournament_id = ? AND slot_index = ?').run(next.player2Id, tournamentId, firstSlot + 1)
      }
    }
    db.prepare(`UPDATE tournaments SET status = 'running' WHERE id = ?`).run(tournamentId)
    refreshFutureMatches(db, tournamentId)
  })()
  return getBracket(db, tournamentId)
}

function loadSongs(db: Db, matchId: number, player1Id?: number | null, player2Id?: number | null): MatchSong[] {
  const rows = db.prepare('SELECT * FROM match_songs WHERE match_id = ? ORDER BY position').all(matchId) as AnyRow[]
  const score = db.prepare('SELECT achievement_scaled FROM scores WHERE match_song_id = ? AND player_id = ?')
  return rows.map((row) => {
    const score1 = player1Id ? (score.get(row.id, player1Id) as AnyRow | undefined)?.achievement_scaled : null
    const score2 = player2Id ? (score.get(row.id, player2Id) as AnyRow | undefined)?.achievement_scaled : null
    return {
      id: row.id,
      position: row.position,
      songId: row.song_id,
      title: row.title,
      artist: row.artist,
      jacketUrl: `/api/songs/${row.song_id}/jacket`,
      chartType: row.chart_type,
      levelIndex: row.level_index,
      level: row.level,
      source: row.source,
      score1: score1 == null ? null : score1 / 10000,
      score2: score2 == null ? null : score2 / 10000
    }
  })
}

function getPlayerById(db: Db, id: number | null, tournamentId?: number) {
  if (!id) return null
  if (tournamentId) {
    const snapshot = db.prepare(`
      SELECT p.id, tp.name_snapshot name, tp.avatar_snapshot avatar_path, p.created_at
      FROM tournament_participants tp
      JOIN players p ON p.id = tp.player_id
      WHERE tp.tournament_id = ? AND tp.player_id = ?
    `).get(tournamentId, id) as AnyRow | undefined
    if (snapshot) return mapPlayer(snapshot)
  }
  return mapPlayer(db.prepare('SELECT * FROM players WHERE id = ?').get(id) as AnyRow)
}

export function getMatch(db: Db, id: number) {
  const row = db.prepare('SELECT * FROM matches WHERE id = ?').get(id) as AnyRow | undefined
  if (!row) throw Object.assign(new Error('对局不存在'), { statusCode: 404 })
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    roundIndex: row.round_index,
    matchIndex: row.match_index,
    player1: getPlayerById(db, row.player1_id, row.tournament_id),
    player2: getPlayerById(db, row.player2_id, row.tournament_id),
    winnerId: row.winner_id ?? null,
    status: row.status,
    total1: row.total1 == null ? null : row.total1 / 10000,
    total2: row.total2 == null ? null : row.total2 / 10000,
    manualPairing: Boolean(row.manual_pairing),
    isTiebreak: Boolean(row.is_tiebreak),
    songs: loadSongs(db, row.id, row.player1_id, row.player2_id)
  }
}

export function getBracket(db: Db, tournamentId: number) {
  const tournament = getTournament(db, tournamentId)
  const matches = (db.prepare('SELECT id FROM matches WHERE tournament_id = ? ORDER BY round_index, match_index').all(tournamentId) as AnyRow[]).map((row) => getMatch(db, row.id))
  return { tournament, matches }
}

function activeTeamTournamentId(db: Db) {
  const existing = db.prepare(`SELECT id FROM tournaments WHERE mode = 'teams' AND active = 1 ORDER BY id DESC LIMIT 1`).get() as AnyRow | undefined
  if (existing) return Number(existing.id)
  const previous = db.prepare(`SELECT id FROM tournaments WHERE mode = 'teams' ORDER BY id DESC LIMIT 1`).get() as AnyRow | undefined
  if (previous) {
    db.transaction(() => {
      db.prepare('UPDATE tournaments SET active = 0').run()
      db.prepare('UPDATE tournaments SET active = 1 WHERE id = ?').run(previous.id)
    })()
    return Number(previous.id)
  }
  return db.transaction(() => {
    db.prepare('UPDATE tournaments SET active = 0').run()
    const tournament = db.prepare(`
      INSERT INTO tournaments(name, bracket_size, active, status, mode)
      VALUES ('队伍对战', 2, 1, 'running', 'teams')
    `).run()
    const tournamentId = Number(tournament.lastInsertRowid)
    const match = db.prepare(`
      INSERT INTO matches(tournament_id, round_index, match_index, status, manual_pairing)
      VALUES (?, 0, 0, 'locked', 1)
    `).run(tournamentId)
    db.prepare('UPDATE tournaments SET current_match_id = ? WHERE id = ?').run(Number(match.lastInsertRowid), tournamentId)
    return tournamentId
  })()
}

export function getTeamBoard(db: Db) {
  const tournamentId = activeTeamTournamentId(db)
  const tournament = getTournament(db, tournamentId)
  const memberRows = db.prepare(`
    SELECT p.*, tm.team_number, tm.sort_order
    FROM team_members tm JOIN players p ON p.id = tm.player_id
    WHERE tm.tournament_id = ?
    ORDER BY tm.team_number, tm.sort_order, p.id
  `).all(tournamentId) as AnyRow[]
  const matches = (db.prepare('SELECT id FROM matches WHERE tournament_id = ? ORDER BY match_index, id').all(tournamentId) as AnyRow[]).map((row) => getMatch(db, row.id))
  const score = matches.reduce((total, match) => {
    if (match.status !== 'completed') return total
    if (match.winnerId === match.player1?.id) total.team1++
    if (match.winnerId === match.player2?.id) total.team2++
    return total
  }, { team1: 0, team2: 0 })
  return {
    tournament,
    members: {
      team1: memberRows.filter((row) => row.team_number === 1).map((row) => mapPlayer(row)!),
      team2: memberRows.filter((row) => row.team_number === 2).map((row) => mapPlayer(row)!)
    },
    matches,
    currentMatchId: tournament.currentMatchId || matches[0]?.id || null,
    score
  }
}

export function updateTeamSettings(db: Db, input: { team1Name?: string; team1Color?: string; team2Name?: string; team2Color?: string }) {
  const tournamentId = activeTeamTournamentId(db)
  const colorPattern = /^#[0-9a-f]{6}$/i
  const team1Name = input.team1Name?.trim()
  const team2Name = input.team2Name?.trim()
  if (!team1Name || !team2Name) throw Object.assign(new Error('两边队伍都需要名称'), { statusCode: 400 })
  if (!colorPattern.test(input.team1Color || '') || !colorPattern.test(input.team2Color || '')) {
    throw Object.assign(new Error('队伍颜色格式无效'), { statusCode: 400 })
  }
  db.prepare(`
    UPDATE tournaments SET team1_name = ?, team1_color = ?, team2_name = ?, team2_color = ? WHERE id = ?
  `).run(team1Name, input.team1Color, team2Name, input.team2Color, tournamentId)
  return getTeamBoard(db)
}

export function updateTeamMembers(db: Db, team1PlayerIds: number[], team2PlayerIds: number[]) {
  const tournamentId = activeTeamTournamentId(db)
  const team1 = [...new Set(team1PlayerIds.map(Number))]
  const team2 = [...new Set(team2PlayerIds.map(Number))]
  if (team1.some((id) => team2.includes(id))) throw Object.assign(new Error('同一位玩家不能同时加入两边队伍'), { statusCode: 400 })
  const all = [...team1, ...team2]
  if (all.length) {
    const found = (db.prepare(`SELECT id FROM players WHERE id IN (${all.map(() => '?').join(',')})`).all(...all) as AnyRow[]).map((row) => row.id)
    if (found.length !== all.length) throw Object.assign(new Error('队伍中包含不存在的玩家'), { statusCode: 400 })
  }
  db.transaction(() => {
    db.prepare('DELETE FROM team_members WHERE tournament_id = ?').run(tournamentId)
    const insertMember = db.prepare('INSERT INTO team_members(tournament_id, team_number, player_id, sort_order) VALUES (?, ?, ?, ?)')
    const insertParticipant = db.prepare(`
      INSERT OR IGNORE INTO tournament_participants(tournament_id, player_id, name_snapshot, avatar_snapshot)
      SELECT ?, id, name, avatar_path FROM players WHERE id = ?
    `)
    team1.forEach((id, index) => {
      insertMember.run(tournamentId, 1, id, index)
      insertParticipant.run(tournamentId, id)
    })
    team2.forEach((id, index) => {
      insertMember.run(tournamentId, 2, id, index)
      insertParticipant.run(tournamentId, id)
    })
  })()
  return getTeamBoard(db)
}

export function resetTeamBoard(db: Db) {
  const board = getTeamBoard(db)
  db.transaction(() => {
    db.prepare('DELETE FROM matches WHERE tournament_id = ?').run(board.tournament.id)
    db.prepare('DELETE FROM team_members WHERE tournament_id = ?').run(board.tournament.id)
    db.prepare('DELETE FROM tournament_participants WHERE tournament_id = ?').run(board.tournament.id)
    const match = db.prepare(`
      INSERT INTO matches(tournament_id, round_index, match_index, status, manual_pairing)
      VALUES (?, 0, 0, 'locked', 1)
    `).run(board.tournament.id)
    db.prepare(`UPDATE tournaments SET current_match_id = ?, status = 'running' WHERE id = ?`)
      .run(Number(match.lastInsertRowid), board.tournament.id)
  })()
  return getTeamBoard(db)
}

export function addTeamRow(db: Db, isTiebreak = false) {
  const tournamentId = activeTeamTournamentId(db)
  const nextIndex = ((db.prepare('SELECT MAX(match_index) value FROM matches WHERE tournament_id = ?').get(tournamentId) as AnyRow).value ?? -1) + 1
  const result = db.prepare(`
    INSERT INTO matches(tournament_id, round_index, match_index, status, manual_pairing, is_tiebreak)
    VALUES (?, 0, ?, 'locked', 1, ?)
  `).run(tournamentId, nextIndex, isTiebreak ? 1 : 0)
  return getMatch(db, Number(result.lastInsertRowid))
}

export function updateTeamRow(db: Db, matchId: number, player1Id: number | null, player2Id: number | null, isTiebreak?: boolean) {
  const board = getTeamBoard(db)
  const match = board.matches.find((item) => item.id === matchId)
  if (!match) throw Object.assign(new Error('对战行不存在'), { statusCode: 404 })
  const first = player1Id == null ? null : Number(player1Id)
  const second = player2Id == null ? null : Number(player2Id)
  if (first && !board.members.team1.some((player) => player!.id === first)) throw Object.assign(new Error(`1P 必须来自${board.tournament.team1Name}`), { statusCode: 400 })
  if (second && !board.members.team2.some((player) => player!.id === second)) throw Object.assign(new Error(`2P 必须来自${board.tournament.team2Name}`), { statusCode: 400 })
  const changed = first !== (match.player1?.id ?? null) || second !== (match.player2?.id ?? null)
  if (changed && (match.status === 'completed' || match.songs?.length)) {
    throw Object.assign(new Error('该行已有曲目或成绩，请先在对局控制中重新打开'), { statusCode: 409 })
  }
  const status = first && second ? 'pending' : 'locked'
  db.prepare(`
    UPDATE matches SET player1_id = ?, player2_id = ?, winner_id = NULL, total1 = NULL, total2 = NULL,
      status = ?, manual_pairing = 1, is_tiebreak = COALESCE(?, is_tiebreak)
    WHERE id = ?
  `).run(first, second, status, isTiebreak == null ? null : isTiebreak ? 1 : 0, matchId)
  return getTeamBoard(db)
}

export function deleteTeamRow(db: Db, matchId: number) {
  const board = getTeamBoard(db)
  const match = board.matches.find((item) => item.id === matchId)
  if (!match) throw Object.assign(new Error('对战行不存在'), { statusCode: 404 })
  db.transaction(() => {
    const next = db.prepare(`
      SELECT id FROM matches
      WHERE tournament_id = ? AND round_index = ? AND id != ?
      ORDER BY ABS(match_index - ?), match_index, id
      LIMIT 1
    `).get(board.tournament.id, match.roundIndex, matchId, match.matchIndex) as AnyRow | undefined
    db.prepare('DELETE FROM matches WHERE id = ?').run(matchId)
    if (board.currentMatchId === matchId) db.prepare('UPDATE tournaments SET current_match_id = ? WHERE id = ?').run(next?.id || null, board.tournament.id)
    const remaining = db.prepare(`
      SELECT id FROM matches WHERE tournament_id = ? AND round_index = ? ORDER BY match_index, id
    `).all(board.tournament.id, match.roundIndex) as AnyRow[]
    const compactIndex = db.prepare('UPDATE matches SET match_index = ? WHERE id = ?')
    remaining.forEach((row, index) => compactIndex.run(index, row.id))
  })()
  return getTeamBoard(db)
}

export function setCurrentTeamRow(db: Db, matchId: number) {
  const board = getTeamBoard(db)
  if (!board.matches.some((match) => match.id === matchId)) throw Object.assign(new Error('对战行不存在'), { statusCode: 404 })
  db.prepare('UPDATE tournaments SET current_match_id = ? WHERE id = ?').run(matchId, board.tournament.id)
  return getTeamBoard(db)
}

export function saveMatchSongs(db: Db, matchId: number, songs: Omit<MatchSong, 'id'>[]) {
  const match = getMatch(db, matchId)
  if (match.status === 'locked' || match.status === 'bye') throw Object.assign(new Error('当前对局尚不可编辑'), { statusCode: 409 })
  if (match.status === 'completed') throw Object.assign(new Error('请先重新打开已确认对局'), { statusCode: 409 })
  db.transaction(() => {
    db.prepare('DELETE FROM match_songs WHERE match_id = ?').run(matchId)
    db.prepare('UPDATE matches SET winner_id = NULL, total1 = NULL, total2 = NULL, manual_winner = 0 WHERE id = ?').run(matchId)
    const insert = db.prepare(`
      INSERT INTO match_songs(match_id, position, song_id, title, artist, jacket_url, chart_type, level_index, level, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    songs.forEach((song, index) => insert.run(matchId, index, song.songId, song.title, song.artist, song.jacketUrl || '', song.chartType, song.levelIndex, song.level, song.source))
  })()
  return getMatch(db, matchId)
}

export function saveScores(db: Db, matchId: number, scores: Array<{ songId: number; playerId: number; achievement: number | null }>) {
  const match = getMatch(db, matchId)
  if (match.status !== 'pending') throw Object.assign(new Error('当前对局不能录入成绩'), { statusCode: 409 })
  const validPlayers = new Set([match.player1?.id, match.player2?.id])
  const songs = new Map(match.songs.map((song) => [song.id, song]))
  const upsert = db.prepare(`INSERT INTO scores(match_song_id, player_id, achievement_scaled) VALUES (?, ?, ?)
    ON CONFLICT(match_song_id, player_id) DO UPDATE SET achievement_scaled = excluded.achievement_scaled`)
  const remove = db.prepare('DELETE FROM scores WHERE match_song_id = ? AND player_id = ?')
  db.transaction(() => {
    for (const item of scores) {
      if (!songs.has(item.songId) || !validPlayers.has(item.playerId)) throw Object.assign(new Error('成绩与当前对局不匹配'), { statusCode: 400 })
      if (item.achievement == null) {
        remove.run(item.songId, item.playerId)
        continue
      }
      if (!Number.isFinite(item.achievement) || item.achievement < 0 || item.achievement > 101) throw Object.assign(new Error('达成率必须在 0 到 101 之间'), { statusCode: 400 })
      upsert.run(item.songId, item.playerId, Math.round(item.achievement * 10000))
    }
  })()
  return getMatch(db, matchId)
}

export function confirmMatch(db: Db, matchId: number, manualWinnerId?: number) {
  const match = getMatch(db, matchId)
  if (match.status !== 'pending' || !match.player1 || !match.player2) throw Object.assign(new Error('当前对局不能确认'), { statusCode: 409 })
  if (!match.songs.length || match.songs.some((song) => song.score1 == null || song.score2 == null)) {
    throw Object.assign(new Error('请先完整录入每首曲目的双方成绩'), { statusCode: 400 })
  }
  const total1 = Math.round(match.songs.reduce((sum, song) => sum + Number(song.score1), 0) * 10000)
  const total2 = Math.round(match.songs.reduce((sum, song) => sum + Number(song.score2), 0) * 10000)
  const tournament = getTournament(db, match.tournamentId)
  if (total1 === total2 && tournament.mode === 'teams') {
    db.prepare(`
      UPDATE matches
      SET total1 = ?, total2 = ?, winner_id = NULL, manual_winner = 0, status = 'completed'
      WHERE id = ?
    `).run(total1, total2, matchId)
    return getMatch(db, matchId)
  }
  let winnerId = total1 > total2 ? match.player1.id : match.player2.id
  let manual = 0
  if (total1 === total2) {
    if (![match.player1.id, match.player2.id].includes(Number(manualWinnerId))) {
      throw Object.assign(new Error('总分相同，请手动指定晋级玩家'), { statusCode: 409, code: 'TIE_REQUIRES_WINNER' })
    }
    winnerId = Number(manualWinnerId)
    manual = 1
  }
  db.transaction(() => {
    db.prepare(`UPDATE matches SET total1 = ?, total2 = ?, winner_id = ?, manual_winner = ?, status = 'completed' WHERE id = ?`).run(total1, total2, winnerId, manual, matchId)
    if (tournament.mode !== 'teams') refreshFutureMatches(db, match.tournamentId)
  })()
  return getMatch(db, matchId)
}

function descendantMatchIds(db: Db, match: ReturnType<typeof getMatch>) {
  const ids: number[] = []
  let round = match.roundIndex + 1
  let index = Math.floor(match.matchIndex / 2)
  while (true) {
    const row = db.prepare('SELECT id FROM matches WHERE tournament_id = ? AND round_index = ? AND match_index = ?').get(match.tournamentId, round, index) as AnyRow | undefined
    if (!row) break
    ids.push(row.id)
    round++
    index = Math.floor(index / 2)
  }
  return ids
}

export function reopenMatch(db: Db, matchId: number, clearDownstream = false) {
  const match = getMatch(db, matchId)
  if (match.status !== 'completed') throw Object.assign(new Error('只有已确认对局可以重新打开'), { statusCode: 409 })
  const tournament = getTournament(db, match.tournamentId)
  const descendants = tournament.mode === 'teams' ? [] : descendantMatchIds(db, match)
  const risky = descendants.some((id) => {
    const row = db.prepare(`SELECT m.status, EXISTS(SELECT 1 FROM match_songs s WHERE s.match_id = m.id) has_songs FROM matches m WHERE m.id = ?`).get(id) as AnyRow
    return row.status === 'completed' || Boolean(row.has_songs)
  })
  if (risky && !clearDownstream) throw Object.assign(new Error('后续对局已有内容，需要确认清除后再修改'), { statusCode: 409, code: 'DOWNSTREAM_HAS_DATA' })
  db.transaction(() => {
    for (const id of descendants) {
      db.prepare('DELETE FROM match_songs WHERE match_id = ?').run(id)
      db.prepare(`UPDATE matches SET player1_id = NULL, player2_id = NULL, winner_id = NULL, total1 = NULL, total2 = NULL, manual_winner = 0, manual_pairing = 0, status = 'locked' WHERE id = ?`).run(id)
    }
    db.prepare(`UPDATE matches SET winner_id = NULL, total1 = NULL, total2 = NULL, manual_winner = 0, status = 'pending' WHERE id = ?`).run(matchId)
    db.prepare(`UPDATE tournaments SET status = 'running' WHERE id = ?`).run(match.tournamentId)
    if (tournament.mode !== 'teams') refreshFutureMatches(db, match.tournamentId)
  })()
  return getMatch(db, matchId)
}

export async function syncSongs(db: Db) {
  const [songResponse, aliasResponse] = await Promise.all([
    fetch(`${LXNS_API_BASE}/api/v0/maimai/song/list`),
    fetch(`${LXNS_API_BASE}/api/v0/maimai/alias/list`)
  ])
  if (!songResponse.ok || !aliasResponse.ok) throw new Error(`落雪 API 请求失败：${songResponse.status}/${aliasResponse.status}`)
  const songData = await songResponse.json() as { songs?: AnyRow[] }
  const aliasData = await aliasResponse.json() as { aliases?: AnyRow[] }
  const aliases = new Map<number, string[]>((aliasData.aliases || []).map((item) => [Number(item.song_id), item.aliases || []]))
  db.transaction(() => {
    const upsert = db.prepare(`
      INSERT INTO song_cache(song_id, title, artist, genre, aliases, payload) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(song_id) DO UPDATE SET title=excluded.title, artist=excluded.artist, genre=excluded.genre, aliases=excluded.aliases, payload=excluded.payload
    `)
    for (const song of songData.songs || []) {
      upsert.run(song.id, song.title, song.artist || '', song.genre || '', JSON.stringify(aliases.get(Number(song.id)) || []), JSON.stringify(song))
    }
    db.prepare(`INSERT INTO app_settings(key, value) VALUES ('song_cache_updated_at', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(new Date().toISOString())
  })()
  return { count: songData.songs?.length || 0, updatedAt: new Date().toISOString() }
}

export function getSongCacheInfo(db: Db) {
  const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'song_cache_updated_at'`).get() as AnyRow | undefined
  const count = (db.prepare('SELECT COUNT(*) count FROM song_cache').get() as AnyRow).count
  return { count, updatedAt: row?.value || null }
}

export function searchSongs(db: Db, query: string, limit = 30): SongSearchResult[] {
  const normalized = `%${query.trim()}%`
  const rows = db.prepare(`
    SELECT * FROM song_cache
    WHERE title LIKE ? COLLATE NOCASE OR artist LIKE ? COLLATE NOCASE OR aliases LIKE ? COLLATE NOCASE
    ORDER BY CASE WHEN title LIKE ? COLLATE NOCASE THEN 0 ELSE 1 END, title
    LIMIT ?
  `).all(normalized, normalized, normalized, `${query.trim()}%`, Math.min(Math.max(limit, 1), 100)) as AnyRow[]
  return rows.map((row) => {
    const payload = JSON.parse(row.payload)
    return {
      id: row.song_id,
      title: row.title,
      artist: row.artist,
      genre: row.genre,
      aliases: JSON.parse(row.aliases),
      difficulties: payload.difficulties || {}
    }
  })
}

function buildSnapshot(db: Db, channel: BroadcastChannel, options: AnyRow) {
  if (channel === 'bracket') {
    const board = getTeamBoard(db)
    if (board.tournament.mode === 'teams') return board
    return getBracket(db, Number(options.tournamentId))
  }
  const match = getMatch(db, Number(options.matchId))
  const tournament = getTournament(db, match.tournamentId)
  if (channel === 'songs') {
    const requestedIds = Array.isArray(options.songIds) ? options.songIds.map(Number) : []
    const songs = requestedIds.length ? match.songs.filter((song) => requestedIds.includes(Number(song.id))) : match.songs
    return { tournament, match: { ...match, songs } }
  }
  return { tournament, match }
}

export function getBroadcastState(db: Db, channel: BroadcastChannel) {
  const row = db.prepare('SELECT published_json FROM broadcast_states WHERE channel = ?').get(channel) as AnyRow
  return {
    channel,
    published: row.published_json ? JSON.parse(row.published_json) : null
  }
}

export function saveBroadcastSnapshot(db: Db, channel: BroadcastChannel, options: AnyRow) {
  const snapshot = buildSnapshot(db, channel, options)
  db.prepare('UPDATE broadcast_states SET published_json = ? WHERE channel = ?').run(JSON.stringify(snapshot), channel)
  return getBroadcastState(db, channel)
}

export function refreshBroadcastChannels(db: Db, requestedChannels: BroadcastChannel[]) {
  const selected = [...new Set(requestedChannels)]
  const board = getTeamBoard(db)
  const states: ReturnType<typeof getBroadcastState>[] = []
  db.transaction(() => {
    for (const channel of selected) {
      const options = channel === 'bracket'
        ? { tournamentId: board.tournament.id }
        : { matchId: board.currentMatchId }
      states.push(saveBroadcastSnapshot(db, channel, options))
    }
  })()
  return states
}

export const jacketSourceUrl = (songId: number) => `${LXNS_ASSET_BASE}/jacket/${songId}.png`
