export type BroadcastChannel = 'match' | 'songs' | 'results' | 'bracket'
export type SongSource = '1p' | '2p' | 'required' | 'tiebreak'
export type MatchStatus = 'locked' | 'pending' | 'completed' | 'bye'

export interface Player {
  id: number
  name: string
  avatarUrl: string | null
  createdAt: string
}

export interface Tournament {
  id: number
  name: string
  bracketSize: number
  active: boolean
  status: 'setup' | 'running' | 'completed'
  createdAt: string
  mode?: 'bracket' | 'teams'
  team1Name?: string
  team1Color?: string
  team2Name?: string
  team2Color?: string
  currentMatchId?: number | null
  participantIds?: number[]
  slots?: Array<number | null>
}

export interface MatchSong {
  id?: number
  position: number
  songId: number
  title: string
  artist: string
  jacketUrl: string
  chartType: 'standard' | 'dx' | 'utage'
  levelIndex: number
  level: string
  source: SongSource
  score1?: number | null
  score2?: number | null
}

export interface BracketMatch {
  id: number
  tournamentId: number
  roundIndex: number
  matchIndex: number
  player1: Player | null
  player2: Player | null
  winnerId: number | null
  status: MatchStatus
  total1: number | null
  total2: number | null
  manualPairing?: boolean
  isTiebreak?: boolean
  songs?: MatchSong[]
}

export interface TeamBoard {
  tournament: Tournament
  members: { team1: Player[]; team2: Player[] }
  matches: BracketMatch[]
  currentMatchId: number | null
  score: { team1: number; team2: number }
}

export interface SongSearchResult {
  id: number
  title: string
  artist: string
  genre: string
  aliases: string[]
  difficulties: Record<string, SongDifficulty[]>
}

export interface SongDifficulty {
  type: 'standard' | 'dx' | 'utage'
  difficulty: number
  level: string
  level_value?: number
  note_designer?: string
}

export interface BroadcastState<T = unknown> {
  channel: BroadcastChannel
  published: T | null
}
