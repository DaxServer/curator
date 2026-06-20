import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope } from 'vue'

const mockOpen = mock(() => {})
const mockClose = mock(() => {})

const mockSocketImpl = () => ({
  useSocket: {
    data: { value: null },
    open: mockOpen,
    close: mockClose,
    send: mock(() => {}),
  },
})

mock.module('@frontend/composables/useSocket', mockSocketImpl)
mock.module('../useSocket', mockSocketImpl)

import { useAuthStore } from '@frontend/stores/auth.store'
import type { useAuthSocket as UseAuthSocketType } from '@frontend/composables/useAuthSocket'
import { resolve } from 'node:path'

describe('useAuthSocket', () => {
  let auth: ReturnType<typeof useAuthStore>
  let useAuthSocket: typeof UseAuthSocketType

  beforeEach(async () => {
    mockOpen.mockClear()
    mockClose.mockClear()
    setActivePinia(createPinia())
    auth = useAuthStore()
    mock.restore()
    mock.module('@frontend/composables/useSocket', mockSocketImpl)
    mock.module('../useSocket', mockSocketImpl)
    mock.module(resolve(__dirname, '../useSocket.ts'), mockSocketImpl)
    ;({ useAuthSocket } = await import('@frontend/composables/useAuthSocket'))
  })

  it('does not open socket when user is unauthenticated on init', () => {
    const scope = effectScope()
    scope.run(() => useAuthSocket())
    expect(mockOpen).not.toHaveBeenCalled()
    scope.stop()
  })

  it('opens socket when user becomes authenticated', () => {
    const scope = effectScope()
    scope.run(() => useAuthSocket())

    auth.user = 'DaxServer'
    expect(mockOpen).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('closes socket when user logs out', () => {
    auth.user = 'DaxServer'
    const scope = effectScope()
    scope.run(() => useAuthSocket())

    auth.user = ''
    expect(mockClose).toHaveBeenCalled()
    scope.stop()
  })

  it('closes socket when scope is disposed', () => {
    auth.user = 'DaxServer'
    const scope = effectScope()
    scope.run(() => useAuthSocket())

    scope.stop()
    expect(mockClose).toHaveBeenCalled()
  })
})
