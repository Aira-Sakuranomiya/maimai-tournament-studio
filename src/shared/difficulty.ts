export const MAIMAI_DIFFICULTIES = [
  { name: 'BASIC', tone: 'basic' },
  { name: 'ADVANCED', tone: 'advanced' },
  { name: 'EXPERT', tone: 'expert' },
  { name: 'MASTER', tone: 'master' },
  { name: 'Re:MASTER', tone: 'remaster' }
] as const

export function difficultyName(index: number) {
  return MAIMAI_DIFFICULTIES[index]?.name ?? `DIFFICULTY ${index}`
}

export function difficultyClass(index: number) {
  return `difficulty-${MAIMAI_DIFFICULTIES[index]?.tone ?? 'unknown'}`
}
