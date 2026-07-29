import { describe, expect, it } from 'vitest'
import { difficultyClass, difficultyName } from './difficulty'

describe('maimai difficulty presentation', () => {
  it.each([
    [0, 'BASIC', 'difficulty-basic'],
    [1, 'ADVANCED', 'difficulty-advanced'],
    [2, 'EXPERT', 'difficulty-expert'],
    [3, 'MASTER', 'difficulty-master'],
    [4, 'Re:MASTER', 'difficulty-remaster']
  ])('maps difficulty %i to %s', (index, name, className) => {
    expect(difficultyName(index)).toBe(name)
    expect(difficultyClass(index)).toBe(className)
  })

  it('keeps an unknown difficulty visible', () => {
    expect(difficultyName(5)).toBe('DIFFICULTY 5')
    expect(difficultyClass(5)).toBe('difficulty-unknown')
  })
})
