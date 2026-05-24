<script setup lang="ts">
import { useSequenceMap } from '@frontend/composables/useSequenceMap'
import { useCollectionsStore } from '@frontend/stores/collections.store'
import maplibregl from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-csp-worker.js?url'
import 'maplibre-gl/dist/maplibre-gl.css'

maplibregl.setWorkerUrl(maplibreWorkerUrl)

const { geoJSON, pathGeoJSON } = useSequenceMap()
const store = useCollectionsStore()
let map: maplibregl.Map | null = null
let startMarker: maplibregl.Marker | null = null
let endMarker: maplibregl.Marker | null = null

const TILE_STYLE = 'https://tiles.openfreemap.org/styles/positron'
const PATH_SOURCE_ID = 'sequence-path'
const PATH_LAYER_ID = 'sequence-path-layer'
const SOURCE_ID = 'sequence-items'
const DIRECTION_LAYER_ID = 'sequence-items-direction'
const LAYER_ID = 'sequence-items-layer'
const LABEL_LAYER_ID = 'sequence-items-label'
const MAP_CONTAINER_ID = 'sequence-map-container'

const showOnlySelected = ref(false)

const displayedGeoJSON = computed(() => ({
  ...geoJSON.value,
  features: showOnlySelected.value
    ? geoJSON.value.features.filter((f) => f.properties?.selected)
    : geoJSON.value.features,
}))

watch(
  () => store.selectedCount,
  (count) => {
    if (count === 0) showOnlySelected.value = false
  },
)

function createBadgeElement(text: string): HTMLElement {
  const el = document.createElement('div')
  el.textContent = text
  el.style.cssText =
    'background:#1e40af;color:#ffffff;font-size:11px;font-weight:600;padding:2px 7px;border-radius:4px;white-space:nowrap;pointer-events:none;font-family:sans-serif;line-height:1.4'
  return el
}

function updateEndpointMarkers() {
  startMarker?.remove()
  endMarker?.remove()
  startMarker = null
  endMarker = null
  if (!map) return

  for (const feature of geoJSON.value.features) {
    const label = feature.properties?.label
    if (label !== 'Start' && label !== 'End') continue
    const [lng, lat] = feature.geometry.coordinates as [number, number]
    const marker = new maplibregl.Marker({
      element: createBadgeElement(label),
      anchor: 'top',
      offset: [0, 8],
    })
      .setLngLat([lng, lat])
      .addTo(map)
    if (label === 'Start') startMarker = marker
    else endMarker = marker
  }
}

function fitAllPoints(animate = false) {
  if (!map) return
  const coords = geoJSON.value.features.map((f) => f.geometry.coordinates as [number, number])
  if (coords.length >= 2) {
    const lngs = coords.map(([lng]) => lng)
    const lats = coords.map(([, lat]) => lat)
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 40, animate },
    )
  } else if (coords.length === 1) {
    map.flyTo({ center: coords[0]!, zoom: 14 })
  }
}

function createDirectionCone(): ImageData {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  // White sector pointing up — SDF tinting handles color
  ctx.fillStyle = 'white'
  ctx.beginPath()
  ctx.moveTo(size / 2, size / 2)
  ctx.arc(size / 2, size / 2, size / 2 - 2, -Math.PI / 2 - Math.PI / 6, -Math.PI / 2 + Math.PI / 6)
  ctx.closePath()
  ctx.fill()
  return ctx.getImageData(0, 0, size, size)
}

onMounted(() => {
  map = new maplibregl.Map({
    container: MAP_CONTAINER_ID,
    style: TILE_STYLE,
    attributionControl: { compact: true },
  })

  map.on('load', () => {
    if (!map) return

    map.addSource(PATH_SOURCE_ID, { type: 'geojson', data: pathGeoJSON.value })
    map.addLayer({
      id: PATH_LAYER_ID,
      type: 'line',
      source: PATH_SOURCE_ID,
      paint: {
        'line-color': '#94a3b8',
        'line-width': 2,
      },
    })

    map.addImage('direction-cone', createDirectionCone(), { sdf: true })
    map.addSource(SOURCE_ID, { type: 'geojson', data: displayedGeoJSON.value })
    map.addLayer({
      id: DIRECTION_LAYER_ID,
      type: 'symbol',
      source: SOURCE_ID,
      minzoom: 16,
      filter: ['has', 'compass_angle'],
      layout: {
        'icon-image': 'direction-cone',
        'icon-rotate': ['get', 'compass_angle'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-size': 0.6,
      },
      paint: {
        'icon-color': ['case', ['get', 'selected'], '#16a34a', '#94a3b8'],
        'icon-opacity': 0.8,
      },
    })
    map.addLayer({
      id: LAYER_ID,
      type: 'circle',
      source: SOURCE_ID,
      paint: {
        'circle-color': ['case', ['get', 'selected'], '#dcfce7', '#cbd5e1'],
        'circle-radius': 6,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': ['case', ['get', 'selected'], '#16a34a', '#94a3b8'],
      },
    })

    map.addLayer({
      id: LABEL_LAYER_ID,
      type: 'symbol',
      source: SOURCE_ID,
      minzoom: 16,
      layout: {
        'text-field': ['get', 'number'],
        'text-size': 16,
        'text-offset': [1.25, 0],
        'text-anchor': 'left',
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: {
        'text-color': ['case', ['get', 'selected'], '#16a34a', '#94a3b8'],
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.5,
      },
    })

    updateEndpointMarkers()
    fitAllPoints(false)
  })
})

watch(displayedGeoJSON, (newGeoJSON) => {
  if (!map) return
  const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined
  source?.setData(newGeoJSON)
  updateEndpointMarkers()
})

watch(pathGeoJSON, (newPathGeoJSON) => {
  if (!map) return
  const source = map.getSource(PATH_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
  source?.setData(newPathGeoJSON)
})

onUnmounted(() => {
  startMarker?.remove()
  endMarker?.remove()
  map?.remove()
  map = null
})
</script>

<template>
  <div class="relative max-w-7xl mx-auto w-full">
    <div
      :id="MAP_CONTAINER_ID"
      class="map-container w-full"
    />
    <div class="absolute top-2 left-2 z-10 flex gap-2">
      <SelectButton
        v-model="showOnlySelected"
        :options="[
          { label: 'All', value: false },
          { label: 'Selected only', value: true },
        ]"
        :allow-empty="false"
        :disabled="store.selectedCount === 0"
        option-label="label"
        option-value="value"
        size="small"
      />
      <Button
        icon="pi pi-expand"
        size="small"
        severity="secondary"
        outlined
        v-tooltip.right="'Reset view'"
        @click="fitAllPoints(true)"
      />
    </div>
  </div>
</template>

<style scoped>
.map-container {
  height: 300px;
}
</style>
