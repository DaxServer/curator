<script setup lang="ts">
const sourceLinks = [
  { text: 'bots', url: 'https://github.com/DaxServer/wikibots' },
  { text: 'app', url: 'https://github.com/DaxServer/curator' },
  { text: 'toolsdb usage', url: 'https://tool-db-usage.toolforge.org/owner/s56192' },
]
</script>

<template>
  <div class="flex flex-col gap-4 max-w-7xl mx-auto mt-10">
    <div class="flex items-center gap-1">
      <i class="pi pi-github"></i>
      &nbsp;
      <template
        v-for="(link, index) in sourceLinks"
        :key="index"
      >
        <ExternalLink
          :href="link.url"
          :show-icon="false"
        >
          {{ link.text }}
        </ExternalLink>
        &nbsp;&bull;&nbsp;
      </template>
      <i class="pi pi-share-alt text-sm!"></i>
      &nbsp;
      <ExternalLink
        href="https://opensource.org/license/mit"
        :show-icon="false"
      >
        MIT licensed
      </ExternalLink>
    </div>
    <div class="flex items-center gap-1">
      <img
        src="https://upload.wikimedia.org/wikipedia/commons/a/a4/Favicon-Phabricator-WM.svg"
        alt="Phabricator logo"
        class="w-4 h-4"
      />
      &nbsp;
      <ExternalLink
        href="https://phabricator.wikimedia.org/project/board/8377/"
        :show-icon="false"
      >
        phabricator
      </ExternalLink>
    </div>
    <div class="flex items-center gap-1">
      <img
        src="https://upload.wikimedia.org/wikipedia/commons/3/3b/Grafana_icon.svg"
        alt="Grafana logo"
        class="w-4 h-4"
      />
      &nbsp;
      <ExternalLink
        href="https://grafana.wmcloud.org/d/TJuKfnt4z/tool-dashboard?orgId=1&var-namespace=tool-curator&var-cluster=P8433460076D33992&from=now-1h&to=now&timezone=utc"
        :show-icon="false"
      >
        grafana
      </ExternalLink>
    </div>
  </div>
</template>
