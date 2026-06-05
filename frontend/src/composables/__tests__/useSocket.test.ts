import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createSocketModule, type SocketFactory, type WsInstance } from '../useSocket'

class MockWS {
  private handlers = new Map<string, Array<(e: Event) => void>>()

  subscribe = (_fn: unknown) => this
  on(type: string, fn: (e: Event) => void) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn])
    return this
  }
  off(type: string, fn: (e: Event) => void) {
    this.handlers.set(
      type,
      (this.handlers.get(type) ?? []).filter((h) => h !== fn),
    )
    return this
  }
  send = (_msg: unknown) => this
  close = () => this

  trigger(type: string) {
    for (const h of this.handlers.get(type) ?? []) h(new Event(type))
  }
}

let currentWs: MockWS | null = null

const mockTreaty: SocketFactory = (_origin) => ({
  ws: {
    subscribe: () => {
      currentWs = new MockWS()
      return currentWs as unknown as WsInstance
    },
  },
})

let pendingReconnect: (() => void) | null = null
let pendingDelay: number | null = null

const mockTimer = {
  set: (fn: () => void, ms: number) => {
    pendingReconnect = fn
    pendingDelay = ms
    return 1 as unknown as ReturnType<typeof setTimeout>
  },
  clear: (_id: ReturnType<typeof setTimeout>) => {
    pendingReconnect = null
    pendingDelay = null
  },
}

type Socket = ReturnType<typeof createSocketModule>
let socket: Socket

describe('useSocket auto-reconnect', () => {
  beforeEach(() => {
    currentWs = null
    pendingReconnect = null
    pendingDelay = null
    socket = createSocketModule(mockTreaty, mockTimer)
  })

  afterEach(() => {
    socket.close()
  })

  it('opens a websocket on open()', () => {
    socket.open()
    expect(currentWs).not.toBeNull()
  })

  it('reconnects after unexpected close', () => {
    socket.open()
    const firstWs = currentWs!

    firstWs.trigger('close')
    expect(pendingReconnect).not.toBeNull()

    pendingReconnect!()
    expect(currentWs).not.toBe(firstWs)
    expect(currentWs).not.toBeNull()
  })

  it('does not reconnect after intentional close', () => {
    socket.open()

    socket.close()
    currentWs!.trigger('close')

    expect(pendingReconnect).toBeNull()
  })

  it('does not reconnect when stale close event fires after close-then-reopen', () => {
    socket.open()
    const oldWs = currentWs!

    socket.close()
    socket.open()

    // old socket's async close event arrives after reopen
    oldWs.trigger('close')

    expect(pendingReconnect).toBeNull()
  })

  it('doubles reconnect delay on repeated failures', () => {
    socket.open()

    currentWs!.trigger('close')
    const firstDelay = pendingDelay

    pendingReconnect!()
    currentWs!.trigger('close')
    const secondDelay = pendingDelay

    expect(secondDelay).toBe((firstDelay ?? 0) * 2)
  })

  it('resets reconnect delay after successful open', () => {
    socket.open()

    currentWs!.trigger('close')
    const baseDelay = pendingDelay

    pendingReconnect!()
    currentWs!.trigger('close')
    const doubledDelay = pendingDelay

    pendingReconnect!()
    currentWs!.trigger('open')

    currentWs!.trigger('close')
    expect(pendingDelay).toBe(baseDelay)
    expect(doubledDelay).toBe((baseDelay ?? 0) * 2)
  })
})
