import {
  createSocketModule,
  type SocketFactory,
  type WsInstance,
} from '@frontend/composables/useSocket'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

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

describe('useSocket send queuing', () => {
  beforeEach(() => {
    currentWs = null
    pendingReconnect = null
    pendingDelay = null
    socket = createSocketModule(mockTreaty, mockTimer)
  })

  afterEach(() => {
    socket.close()
  })

  it('queues messages sent before open event and delivers them once connected', () => {
    socket.open()
    const sent: unknown[] = []
    currentWs!.send = (msg) => {
      sent.push(msg)
      return currentWs!
    }

    socket.send({ type: 'FETCH_BATCHES', data: { page: 1, limit: 100 } } as never)

    expect(sent).toHaveLength(0)

    currentWs!.trigger('open')

    expect(sent).toHaveLength(1)
  })

  it('preserves queued messages across reconnect and delivers them once reconnected', () => {
    socket.open()
    currentWs!.trigger('open')

    // socket drops
    currentWs!.trigger('close')

    // message sent during reconnect delay — should be queued, not lost
    const sent: unknown[] = []
    const deliverTo = (ws: MockWS) => {
      ws.send = (msg) => {
        sent.push(msg)
        return ws
      }
    }

    socket.send({ type: 'FETCH_BATCHES', data: { page: 1, limit: 100 } } as never)

    // reconnect fires
    pendingReconnect!()
    deliverTo(currentWs!)
    currentWs!.trigger('open')

    expect(sent).toHaveLength(1)
  })

  it('sends immediately when already connected', () => {
    socket.open()
    const sent: unknown[] = []
    currentWs!.send = (msg) => {
      sent.push(msg)
      return currentWs!
    }

    currentWs!.trigger('open')
    socket.send({ type: 'FETCH_BATCHES', data: { page: 1, limit: 100 } } as never)

    expect(sent).toHaveLength(1)
  })
})

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

describe('useSocket connected ref', () => {
  beforeEach(() => {
    currentWs = null
    pendingReconnect = null
    pendingDelay = null
    socket = createSocketModule(mockTreaty, mockTimer)
  })

  afterEach(() => {
    socket.close()
  })

  it('is false before the WebSocket opens', () => {
    socket.open()
    expect(socket.connected.value).toBe(false)
  })

  it('becomes true when the WebSocket open event fires', () => {
    socket.open()
    currentWs!.trigger('open')
    expect(socket.connected.value).toBe(true)
  })

  it('becomes false when the WebSocket close event fires', () => {
    socket.open()
    currentWs!.trigger('open')
    currentWs!.trigger('close')
    expect(socket.connected.value).toBe(false)
  })
})
