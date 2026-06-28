<script setup lang="ts">
import type { ColorVariant } from '@frontend/composables/useUploadStatus'
import { COLOR_VARIANTS } from '@frontend/composables/useUploadStatus'

const props = withDefaults(
  defineProps<{
    label: string
    count?: number
    color?: ColorVariant
    alwaysActive?: boolean
    selected?: boolean
  }>(),
  {
    color: 'gray',
    alwaysActive: false,
    selected: false,
  },
)

defineEmits<{
  click: []
}>()

const isActive = computed(
  () => props.count !== undefined && (props.alwaysActive || props.count > 0),
)

const colors = computed(() => {
  const variant = COLOR_VARIANTS[props.color]
  return {
    bg: variant.bg,
    border: variant.border,
    labelColor: isActive.value ? variant.labelColor : variant.labelColorInactive,
    countColor: isActive.value ? variant.countColor : variant.countColorInactive,
    ring: variant.ring,
  }
})
</script>

<template>
  <div
    class="flex flex-col p-3 border rounded-lg transition-all duration-200"
    :class="[
      colors.bg,
      colors.border,
      isActive ? 'hover:cursor-pointer hover:shadow-md' : 'hover:cursor-default',
      count !== undefined && selected ? `ring-2 ${colors.ring}` : '',
    ]"
    @click="isActive && $emit('click')"
  >
    <span
      class="text-xs font-medium uppercase"
      :class="colors.labelColor"
    >
      {{ label }}
    </span>
    <span
      class="text-2xl font-bold mt-1"
      :class="colors.countColor"
    >
      <Skeleton v-if="count === undefined" />
      <template v-else>
        {{ count }}
      </template>
    </span>
  </div>
</template>
