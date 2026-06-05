import { mock } from 'bun:test'

export const debounceMock = {
  pendingExecutors: [] as (() => unknown)[],
  reset() {
    this.pendingExecutors = []
  },
}

mock.module('ts-debounce', () => ({
  debounce: (fn: (...args: unknown[]) => unknown) => {
    let cancelled = false
    let callId = 0
    const debounced = (...args: unknown[]) => {
      callId += 1
      const currentCallId = callId
      debounceMock.pendingExecutors.push(() => {
        if (cancelled) return
        if (currentCallId !== callId) return
        return fn(...args)
      })
    }
    debounced.cancel = () => {
      cancelled = true
    }
    return debounced
  },
}))
