<script setup lang="ts">
import { useCollectionsStore } from '@frontend/stores/collections.store'
import type { DistanceUnit, IntervalUnit } from '@frontend/types/collections'
import { DISTANCE_UNITS, INTERVAL_UNITS } from '@frontend/types/collections'

const store = useCollectionsStore()
const helpVisible = ref(false)

const emit = defineEmits(['select:currentPage'])

const nthN = ref<number | null>(2)

const minIntervalSeconds = ref<number | null>(10)
const intervalUnit = ref<IntervalUnit>('seconds')
const intervalUnitOptions = INTERVAL_UNITS.map((u) => ({ label: u, value: u }))

const minDistance = ref<number | null>(100)
const distanceUnit = ref<DistanceUnit>('meters')
const distanceUnitOptions = DISTANCE_UNITS.map((u) => ({ label: u, value: u }))
const distanceMethod = ref<'traversal' | 'straight-line'>('traversal')
const distanceMethodOptions = [
  { label: 'traversed-path', value: 'traversal' },
  { label: 'straight-line', value: 'straight-line' },
]

const minDistanceInMeters = computed(() => {
  if (minDistance.value === null) return null
  if (distanceUnit.value === 'kilometers') return minDistance.value * 1000
  return minDistance.value
})

const minIntervalInSeconds = computed(() => {
  if (minIntervalSeconds.value === null) return null
  if (intervalUnit.value === 'minutes') return minIntervalSeconds.value * 60
  if (intervalUnit.value === 'milliseconds') return minIntervalSeconds.value / 1000
  return minIntervalSeconds.value
})

const ordinal = (n: number): string => {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  const mod10 = n % 10
  if (mod10 === 1) return `${n}st`
  if (mod10 === 2) return `${n}nd`
  if (mod10 === 3) return `${n}rd`
  return `${n}th`
}

const ordinalSuffix = (n: number): string => ordinal(n).slice(-2)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex justify-between items-center gap-4">
      <div class="flex items-center gap-4 w-auto flex-grow-0 flex-shrink-0">
        <SimpleMessage
          severity="info"
          :closable="false"
          icon="pi pi-info-circle"
        >
          Click on images to select
        </SimpleMessage>

        <span
          v-tooltip.bottom="
            store.isBatchLoading ? 'Controls disabled while images are being retrieved' : ''
          "
          class="inline-block"
        >
          <SelectButton
            v-model="store.viewMode"
            :options="[
              { label: 'List', value: 'list', icon: 'pi pi-list' },
              { label: 'Grid', value: 'grid', icon: 'pi pi-th-large' },
            ]"
            :allowEmpty="false"
            :disabled="store.isBatchLoading"
            option-label="label"
            option-value="value"
            data-key="value"
            @update:model-value="store.viewMode = $event"
          >
            <template #option="{ option }">
              <i :class="option.icon" />
              <span>{{ option.label }}</span>
            </template>
          </SelectButton>
        </span>
      </div>

      <div class="flex items-center gap-4">
        <span class="text-base">
          <span class="text-green-600 font-medium">{{ store.selectedCount }}</span>
          selected
        </span>

        <span
          class="inline-block"
          v-tooltip.top="
            store.isBatchLoading
              ? 'Controls disabled while images are being retrieved'
              : store.selectedCount === 0
                ? 'Select at least one image to proceed'
                : ''
          "
        >
          <Button
            severity="primary"
            :disabled="store.selectedCount === 0 || store.isBatchLoading"
            @click="store.stepper = '3'"
            :label="store.selectedCount === 0 ? 'Select items' : 'Start editing'"
          />
        </span>
      </div>
    </div>

    <div class="flex items-center gap-3">
      <span class="text-md text-gray-600">Select</span>
      <Button
        class="hover-primary"
        severity="secondary"
        outlined
        label="All images"
        :disabled="store.isBatchLoading"
        @click="store.selectAll()"
      />
      <Button
        class="hover-primary"
        severity="secondary"
        outlined
        label="Current page"
        :disabled="store.isBatchLoading"
        @click="emit('select:currentPage')"
      />
      <Button
        class="hover-primary"
        severity="secondary"
        outlined
        label="Unuploaded"
        :disabled="store.isBatchLoading"
        @click="store.selectUnuploaded()"
      />
      <Button
        v-if="store.selectedCount > 0"
        class="hover-danger-filled"
        severity="danger"
        outlined
        label="Deselect all"
        :disabled="store.isBatchLoading"
        @click="store.deselectAll()"
      />
    </div>

    <Divider />

    <div
      v-if="store.totalImages > 1"
      class="flex items-center gap-4"
    >
      <span class="text-md font-semibold text-surface-600">Filters</span>
      <Button
        severity="secondary"
        outlined
        size="small"
        icon="pi pi-question-circle"
        label="How do filters work?"
        :disabled="store.isBatchLoading"
        @click="helpVisible = true"
      />
    </div>

    <FiltersHelpDialog v-model="helpVisible" />

    <div
      v-if="store.totalImages > 1"
      class="flex items-center gap-3"
    >
      <span class="text-md text-gray-600">Select every</span>
      <InputNumber
        v-model="nthN"
        :min="2"
        :max="store.totalImages"
        :step="1"
        size="small"
        show-buttons
        button-layout="horizontal"
        increment-button-icon="pi pi-plus"
        decrement-button-icon="pi pi-minus"
        :allow-empty="false"
        :use-grouping="false"
        input-class="w-20 text-center"
        :disabled="store.isBatchLoading"
      />
      <span class="text-md text-gray-600">
        -{{ nthN !== null && nthN >= 2 ? ordinalSuffix(nthN) : '' }} item and
      </span>
      <Button
        class="hover-primary"
        severity="secondary"
        outlined
        label="replace entire selection"
        :disabled="nthN === null || nthN < 2 || store.isBatchLoading"
        v-tooltip.right="
          nthN !== null && nthN >= 2
            ? `Clears the current selection, then selects every ${ordinal(nthN)} image.`
            : ''
        "
        @click="store.selectEveryNth(nthN!, false)"
      />
      <span class="text-sm text-gray-400">or</span>
      <Button
        class="hover-primary"
        severity="secondary"
        outlined
        label="add to selection"
        :disabled="nthN === null || nthN < 2 || store.isBatchLoading"
        v-tooltip.right="
          nthN !== null && nthN >= 2
            ? `Keeps the current selection and also selects every ${ordinal(nthN)} image.`
            : ''
        "
        @click="store.selectEveryNth(nthN!, true)"
      />
    </div>

    <div
      v-if="store.totalImages > 1"
      class="flex items-center gap-3"
    >
      <span class="text-md text-gray-600">Select every</span>
      <InputNumber
        v-model="minIntervalSeconds"
        :min="1"
        :step="1"
        size="small"
        show-buttons
        button-layout="horizontal"
        increment-button-icon="pi pi-plus"
        decrement-button-icon="pi pi-minus"
        :allow-empty="false"
        :use-grouping="false"
        input-class="w-20 text-center"
        :disabled="store.isBatchLoading"
      />
      <Select
        v-model="intervalUnit"
        :options="intervalUnitOptions"
        option-label="label"
        option-value="value"
        size="small"
        :disabled="store.isBatchLoading"
      />
      <span class="text-md text-gray-600">apart and</span>
      <Button
        class="hover-primary"
        severity="secondary"
        outlined
        label="replace entire selection"
        :disabled="minIntervalInSeconds === null || store.isBatchLoading"
        v-tooltip.right="
          minIntervalInSeconds !== null
            ? `Clears the current selection, then selects images at least ${minIntervalSeconds} ${minIntervalSeconds === 1 ? intervalUnit.replace(/s$/, '') : intervalUnit} apart.`
            : ''
        "
        @click="store.selectByMinInterval(minIntervalInSeconds!, false)"
      />
      <span class="text-sm text-gray-400">or</span>
      <Button
        class="hover-primary"
        severity="secondary"
        outlined
        label="add to selection"
        :disabled="minIntervalInSeconds === null || store.isBatchLoading"
        v-tooltip.right="
          minIntervalInSeconds !== null
            ? `Keeps the current selection and also selects images at least ${minIntervalSeconds} ${minIntervalSeconds === 1 ? intervalUnit.replace(/s$/, '') : intervalUnit} apart.`
            : ''
        "
        @click="store.selectByMinInterval(minIntervalInSeconds!, true)"
      />
    </div>

    <div
      v-if="store.totalImages > 1"
      class="flex items-center gap-3"
    >
      <span class="text-md text-gray-600">Select every</span>
      <InputNumber
        v-model="minDistance"
        :min="1"
        :step="1"
        size="small"
        show-buttons
        button-layout="horizontal"
        increment-button-icon="pi pi-plus"
        decrement-button-icon="pi pi-minus"
        :allow-empty="false"
        :use-grouping="false"
        input-class="w-20 text-center"
        :disabled="store.isBatchLoading"
      />
      <Select
        v-model="distanceUnit"
        :options="distanceUnitOptions"
        option-label="label"
        option-value="value"
        size="small"
        :disabled="store.isBatchLoading"
      />
      <span class="text-md text-gray-600">apart along</span>
      <SelectButton
        v-model="distanceMethod"
        :options="distanceMethodOptions"
        option-label="label"
        option-value="value"
        :allow-empty="false"
        size="small"
        :disabled="store.isBatchLoading"
      />
      <span class="text-md text-gray-600">and</span>
      <Button
        class="hover-primary"
        severity="secondary"
        outlined
        label="replace entire selection"
        :disabled="minDistanceInMeters === null || store.isBatchLoading"
        v-tooltip.right="
          minDistanceInMeters !== null
            ? `Clears the current selection, then selects images at least ${minDistance} ${minDistance === 1 ? distanceUnit.replace(/s$/, '') : distanceUnit} apart (${distanceMethod === 'traversal' ? 'measured along the path' : 'straight-line'}).`
            : ''
        "
        @click="
          distanceMethod === 'traversal'
            ? store.selectByTraversalDistance(minDistanceInMeters!, false)
            : store.selectByMinDistance(minDistanceInMeters!, false)
        "
      />
      <span class="text-sm text-gray-400">or</span>
      <Button
        class="hover-primary"
        severity="secondary"
        outlined
        label="add to selection"
        :disabled="minDistanceInMeters === null || store.isBatchLoading"
        v-tooltip.right="
          minDistanceInMeters !== null
            ? `Keeps the current selection and also selects images at least ${minDistance} ${minDistance === 1 ? distanceUnit.replace(/s$/, '') : distanceUnit} apart (${distanceMethod === 'traversal' ? 'measured along the path' : 'straight-line'}).`
            : ''
        "
        @click="
          distanceMethod === 'traversal'
            ? store.selectByTraversalDistance(minDistanceInMeters!, true)
            : store.selectByMinDistance(minDistanceInMeters!, true)
        "
      />
    </div>
  </div>
</template>

<style scoped>
:deep(.hover-primary:not(:disabled):hover) {
  background: var(--p-button-primary-background) !important;
  border-color: var(--p-button-primary-border-color) !important;
  color: var(--p-button-primary-color) !important;
}

:deep(.hover-danger-filled:not(:disabled):hover) {
  background: var(--p-button-danger-background) !important;
  border-color: var(--p-button-danger-border-color) !important;
  color: var(--p-button-danger-color) !important;
}
</style>
