<script setup lang="ts">
import { useAuthStore } from '@frontend/stores/auth.store'

const auth = useAuthStore()
</script>

<template>
  <div
    v-if="auth.maintenance && auth.isAdmin"
    class="bg-amber-100 border-b border-amber-300 text-amber-900 px-4 py-2 flex items-center text-sm"
  >
    <span class="font-semibold mr-1">Maintenance mode active.</span>
    <span>Regular users are seeing the maintenance page.</span>
  </div>
</template>
