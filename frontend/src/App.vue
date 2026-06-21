<script setup lang="ts">
import { useAuthSocket } from '@frontend/composables/useAuthSocket'
import { initCollectionsListeners } from '@frontend/composables/useCollections'
import { useAuthStore } from '@frontend/stores/auth.store'
import { useCollectionsStore } from '@frontend/stores/collections.store'

const store = useCollectionsStore()
const auth = useAuthStore()
const isDev = import.meta.env.DEV

useAuthSocket()
initCollectionsListeners()
</script>

<template>
  <main>
    <ConfirmDialog />
    <Toast />
    <Header />
    <DevAuthBanner v-if="isDev" />
    <MaintenanceBanner />
    <BetaBanner />

    <template v-if="auth.isAuthenticated">
      <div
        v-if="store.error"
        class="max-w-7xl mx-auto mb-4"
      >
        <Message
          severity="error"
          icon="pi pi-exclamation-triangle"
          :closable="true"
          @close="store.clearError"
        >
          {{ store.error }}
        </Message>
      </div>
      <router-view v-slot="{ Component }">
        <KeepAlive :include="['BatchesView']">
          <component :is="Component" />
        </KeepAlive>
      </router-view>
    </template>

    <div
      v-else
      class="py-48 flex justify-center items-center"
    >
      <Button
        color="primary"
        :loading="auth.isLoading"
        :disabled="auth.isLoading"
        label="Login with Wikimedia Commons"
        @click="auth.login"
      />
    </div>

    <Footer />
  </main>
</template>
