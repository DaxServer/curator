import { WORKER_SHUTDOWN_CHANNEL, subscribeWorkerShutdown } from '@backend/workers/signal'
import { describe, expect, it, mock } from 'bun:test'
import type { Redis } from 'ioredis'

describe('subscribeWorkerShutdown', () => {
  it('subscribes to the shutdown channel', () => {
    const subscribeMock = mock(() => {})
    const onMock = mock(() => {})
    const redis = { subscribe: subscribeMock, on: onMock } as unknown as Redis

    subscribeWorkerShutdown(redis, () => {})

    expect(subscribeMock).toHaveBeenCalledWith(WORKER_SHUTDOWN_CHANNEL)
  })

  it('calls onShutdown when a message arrives on the shutdown channel', () => {
    let messageHandler: ((channel: string, message: string) => void) | null = null
    const subscribeMock = mock(() => {})
    const onMock = mock((event: string, handler: (channel: string, message: string) => void) => {
      if (event === 'message') messageHandler = handler
    })
    const redis = { subscribe: subscribeMock, on: onMock } as unknown as Redis
    const onShutdown = mock(() => {})

    subscribeWorkerShutdown(redis, onShutdown)
    messageHandler!(WORKER_SHUTDOWN_CHANNEL, '1')

    expect(onShutdown).toHaveBeenCalledTimes(1)
  })

  it('does not call onShutdown for unrelated channels', () => {
    let messageHandler: ((channel: string, message: string) => void) | null = null
    const subscribeMock = mock(() => {})
    const onMock = mock((event: string, handler: (channel: string, message: string) => void) => {
      if (event === 'message') messageHandler = handler
    })
    const redis = { subscribe: subscribeMock, on: onMock } as unknown as Redis
    const onShutdown = mock(() => {})

    subscribeWorkerShutdown(redis, onShutdown)
    messageHandler!('other:channel', '1')

    expect(onShutdown).not.toHaveBeenCalled()
  })
})
