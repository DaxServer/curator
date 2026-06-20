<script setup lang="ts">
import { useAuthStore } from '@frontend/stores/auth.store'

const auth = useAuthStore()
const route = useRoute()
</script>

<template>
  <div class="max-w-7xl mx-auto flex justify-between">
    <div class="flex items-end">
      <span class="text-2xl mr-5">Curator</span>
      <Button
        as="router-link"
        to="/mapillary"
        label="Mapillary"
        :outlined="!route.path.startsWith('/mapillary')"
      />
    </div>

    <div class="flex items-center gap-2">
      <Button
        as="a"
        href="https://phabricator.wikimedia.org/maniphest/task/edit/form/43/?projectPHIDs=tool-curator&subscriberPHIDs=DaxServer"
        target="_blank"
        label="Report issues"
        severity="help"
        text
      />
      <Button
        v-if="!auth.isAuthenticated"
        label="Login"
        :loading="auth.isLoading"
        :disabled="auth.isLoading"
        @click="auth.login"
      />
      <template v-else>
        <span class="text-gray-600">Hello, {{ auth.user }}!</span>
        <Button
          v-if="auth.isAdmin"
          as="router-link"
          to="/admin"
          label="Admin"
          severity="info"
          class="mr-2"
        />
        <Button
          as="router-link"
          to="/batches"
          label="Past uploads"
          severity="secondary"
        />
        <Button
          label="Logout"
          outlined
          severity="danger"
          @click="auth.logout"
        />
      </template>
    </div>
  </div>
  <Divider />
</template>
