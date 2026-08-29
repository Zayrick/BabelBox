import { describe, expect, it, vi } from 'vitest'
import {
  advanceVocabularyReviewSession,
  createVocabularyLifecycleGuard,
  createVocabularyReviewSession,
  reconcileVocabularyReviewSession,
  vocabularyReviewSessionProgress,
  type VocabularyEntry,
} from '@/src/features/vocabulary/learningModel'

const NOW = 10_000

function entry(id: string, overrides: Partial<VocabularyEntry> = {}): VocabularyEntry {
  return {
    id,
    identityKey: `en:${id}`,
    sourceLanguage: 'en',
    term: id,
    normalizedTerm: id,
    translations: {},
    phonetic: '',
    partOfSpeech: '',
    contexts: [],
    createdAt: 1,
    updatedAt: 1,
    lastSeenAt: 1,
    encounterCount: 1,
    masteryLevel: 0,
    status: 'new',
    nextReviewAt: NOW,
    lastReviewedAt: null,
    reviewCount: 0,
    lapseCount: 0,
    schemaVersion: 1,
    ...overrides,
  }
}

describe('vocabulary learning model', () => {
  it('advances a reviewed card without disturbing the remaining queue', () => {
    const first = entry('first')
    const second = entry('second')
    const session = createVocabularyReviewSession([first, second])
    expect(advanceVocabularyReviewSession(session, 'second')).toMatchObject({
      queue: [first],
      completed: 1,
      answerVisible: false,
    })
    expect(advanceVocabularyReviewSession(session, 'missing')).toMatchObject({
      queue: [first, second],
      completed: 0,
      answerVisible: false,
    })
  })

  it('hides an answer when the current card changes and preserves it otherwise', () => {
    const current = entry('current')
    const session = { queue: [current], completed: 2, answerVisible: true }

    expect(reconcileVocabularyReviewSession(session, [entry('current', { updatedAt: 2 })], NOW).answerVisible).toBe(false)
    expect(reconcileVocabularyReviewSession(session, [current], NOW).answerVisible).toBe(true)

    expect(vocabularyReviewSessionProgress({ queue: [], completed: 2, answerVisible: false })).toEqual({
      current: null,
      position: 2,
      total: 2,
    })
  })

  it('runs initialization only while the lifecycle remains active', async () => {
    const initialize = vi.fn()
    const active = createVocabularyLifecycleGuard()
    await expect(active.runAfterReady(Promise.resolve(), initialize)).resolves.toBe(true)
    expect(initialize).toHaveBeenCalledOnce()

    const disposedDuringInitialization = createVocabularyLifecycleGuard()
    await expect(disposedDuringInitialization.runAfterReady(Promise.resolve(), () => {
      disposedDuringInitialization.dispose()
    })).resolves.toBe(false)
  })
})
