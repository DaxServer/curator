<script setup lang="ts">
import { useCommons } from '@frontend/composables/useCommons'
import { useCollectionsStore } from '@frontend/stores/collections.store'
import type { Item } from '@frontend/types/image'

const props = defineProps<{
  item: Item
  altPrefix: string
}>()

const store = useCollectionsStore()
const { getEffectiveTitle, wikitext } = useCommons()

const labels = computed(() => [
  {
    language: props.item.meta.description.language.trim() || store.globalLanguage.trim(),
    value: props.item.meta.description.value.trim() || store.globalDescription.trim(),
  },
])
</script>

<template>
  <div class="flex flex-col gap-6">
    <div>
      <div class="text-base font-bold text-surface-900 mb-1">
        File:{{ getEffectiveTitle(item) }}
      </div>
      <pre
        class="text-xs bg-surface-100 p-2 rounded overflow-x-auto font-mono text-surface-700 border border-surface-200"
        >{{ wikitext(item).trim() }}</pre>
    </div>

    <div class="flex flex-col gap-2">
      <div class="text-sm font-bold text-surface-500 uppercase tracking-wider">Labels</div>
      <DataTable
        :value="labels"
        size="small"
        class="text-sm"
        stripedRows
      >
        <Column
          field="language"
          header="Language"
        />
        <Column
          field="value"
          header="Label"
        />
      </DataTable>
    </div>

    <div class="flex flex-col gap-2">
      <div class="text-sm font-bold text-surface-500 uppercase tracking-wider">SDC</div>
      <StatementsList
        :id="item.id"
        :image="item.image"
        :license="item.meta.license"
      />
    </div>
  </div>
</template>
