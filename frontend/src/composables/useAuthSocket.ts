import { useSocket } from '@frontend/composables/useSocket'
import { useAuthStore } from '@frontend/stores/auth.store'
import { onScopeDispose, watch } from 'vue'

export function useAuthSocket() {
  const auth = useAuthStore()
  const { open, close } = useSocket

  watch(
    () => auth.isAuthenticated,
    (authenticated) => {
      if (authenticated) open()
      else close()
    },
    { flush: 'sync' },
  )

  onScopeDispose(close)
}
