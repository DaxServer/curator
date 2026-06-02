<script setup lang="ts">
const visible = ref(true)
const phabricatorUrl =
  'https://phabricator.wikimedia.org/maniphest/task/edit/form/43/?projectPHIDs=tool-curator&subscriberPHIDs=DaxServer'
</script>

<template>
  <div
    v-if="visible"
    class="max-w-7xl mx-auto my-2"
  >
    <Message
      severity="info"
      :closable="true"
      @close="visible = false"
    >
      <span class="font-semibold">New version:</span>
      This tool is running a new version of the software. If you encounter any bugs, please
      <ExternalLink
        :href="phabricatorUrl"
        class="underline font-semibold"
      >
        report them on Phabricator
      </ExternalLink>
      .
    </Message>
  </div>
</template>
