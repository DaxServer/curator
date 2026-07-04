import type { App } from '@backend/app'
import type { ClientMessage, ServerMessage } from '@backend/types/ws'
import { treaty } from '@elysiajs/eden'
import { ref } from 'vue'

const RECONNECT_BASE_DELAY = 1_000
const RECONNECT_MAX_DELAY = 30_000

const getOrigin = () =>
  typeof location !== 'undefined' ? location.origin : 'http://localhost:8000'

type TreatyClient = ReturnType<typeof treaty<App>>
export type WsInstance = ReturnType<TreatyClient['ws']['subscribe']>
export type SocketFactory = (origin: string) => { ws: { subscribe(): WsInstance } }

type TimerHandle = ReturnType<typeof setTimeout>

const defaultTimer = {
  set: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clear: (id: TimerHandle) => clearTimeout(id),
}

export const createSocketModule = (
  treatyFn: SocketFactory = treaty as unknown as SocketFactory,
  timer = defaultTimer,
) => {
  const data = ref<ServerMessage | null>(null)
  const connected = ref(false)
  let _ws: WsInstance | null = null
  let _reconnectDelay = RECONNECT_BASE_DELAY
  let _reconnectTimer: TimerHandle | null = null
  let _active = false
  let _pendingQueue: ClientMessage[] = []

  const _onOpen = () => {
    connected.value = true
    _reconnectDelay = RECONNECT_BASE_DELAY
    for (const msg of _pendingQueue) _ws?.send(msg)
    _pendingQueue = []
  }

  const _onClose = () => {
    connected.value = false
    if (_active) _scheduleReconnect()
  }

  const _scheduleReconnect = () => {
    if (_reconnectTimer !== null) timer.clear(_reconnectTimer)
    _reconnectTimer = timer.set(() => {
      _reconnectTimer = null
      if (_active) open(true)
    }, _reconnectDelay)
    _reconnectDelay = Math.min(_reconnectDelay * 2, RECONNECT_MAX_DELAY)
  }

  const open = (isReconnect = false) => {
    _active = true
    connected.value = false
    if (!isReconnect) {
      _pendingQueue = []
      _reconnectDelay = RECONNECT_BASE_DELAY
    }
    if (_ws) {
      _ws.off('close', _onClose)
      _ws.close()
    }
    _ws = null
    const client = treatyFn(getOrigin())
    _ws = client.ws.subscribe()
    _ws.subscribe((event) => {
      data.value = event.data
    })
    _ws.on('open', _onOpen)
    _ws.on('close', _onClose)
  }

  const send = (msg: ClientMessage) => {
    if (!connected.value) {
      _pendingQueue.push(msg)
      return
    }
    _ws?.send(msg)
  }

  const close = () => {
    _active = false
    if (_reconnectTimer !== null) timer.clear(_reconnectTimer)
    _reconnectTimer = null
    if (_ws) {
      _ws.off('close', _onClose)
      _ws.close()
    }
    _ws = null
  }

  return { data, connected, open, send, close }
}

export const useSocket = createSocketModule()
