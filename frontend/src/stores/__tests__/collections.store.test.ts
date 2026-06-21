import { makeItem, makePreset } from '@frontend/__tests__/fixtures'
import { useCollectionsStore } from '@frontend/stores/collections.store'
import { beforeEach, describe, expect, it } from 'bun:test'
import { createPinia, setActivePinia } from 'pinia'

// ~111m per 0.001° at equator; shorthand for makeItem with lat/lon
const pt = (index: number, selected: boolean, lat: number, lon: number) =>
  makeItem(index, selected, undefined, lat, lon)

describe('selection methods', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('selectEveryNth', () => {
    it('selects every Nth item by 1-based index when add is false', () => {
      const store = useCollectionsStore()
      store.replaceItems({
        'item-1': makeItem(1),
        'item-2': makeItem(2),
        'item-3': makeItem(3),
        'item-4': makeItem(4),
        'item-5': makeItem(5),
        'item-6': makeItem(6),
      })

      store.selectEveryNth(2, false)

      expect(store.itemsArray.map((i) => i.meta.selected)).toEqual([
        false,
        true,
        false,
        true,
        false,
        true,
      ])
    })

    it('clears existing selection before selecting when add is false', () => {
      const store = useCollectionsStore()
      store.replaceItems({
        'item-1': makeItem(1, true),
        'item-2': makeItem(2, false),
        'item-3': makeItem(3, false),
      })

      store.selectEveryNth(3, false)

      expect(store.itemsArray.map((i) => i.meta.selected)).toEqual([false, false, true])
    })

    it('adds to existing selection when add is true', () => {
      const store = useCollectionsStore()
      store.replaceItems({
        'item-1': makeItem(1, true),
        'item-2': makeItem(2, false),
        'item-3': makeItem(3, false),
        'item-4': makeItem(4, false),
      })

      store.selectEveryNth(2, true)

      expect(store.itemsArray.map((i) => i.meta.selected)).toEqual([true, true, false, true])
    })
  })

  describe('selectByMinInterval', () => {
    const t = (s: number) => new Date(s * 1000)

    it('always selects first item', () => {
      const store = useCollectionsStore()
      store.replaceItems({ a: makeItem(1, false, t(0)) })

      store.selectByMinInterval(10, false)

      expect(store.itemsArray[0]!.meta.selected).toBe(true)
    })

    it('selects items meeting the minimum interval from first', () => {
      const store = useCollectionsStore()
      store.replaceItems({
        a: makeItem(1, false, t(0)),
        b: makeItem(2, false, t(5)),
        c: makeItem(3, false, t(10)),
        d: makeItem(4, false, t(15)),
        e: makeItem(5, false, t(20)),
      })

      store.selectByMinInterval(10, false)

      expect(store.itemsArray.map((i) => i.meta.selected)).toEqual([true, false, true, false, true])
    })

    it('measures elapsed from last selected item, not last item', () => {
      const store = useCollectionsStore()
      store.replaceItems({
        a: makeItem(1, false, t(0)),
        b: makeItem(2, false, t(5)),
        c: makeItem(3, false, t(8)),
        d: makeItem(4, false, t(12)),
      })

      store.selectByMinInterval(10, false)

      // b (5s from a) and c (8s from a) both rejected; d (12s from a) accepted
      expect(store.itemsArray.map((i) => i.meta.selected)).toEqual([true, false, false, true])
    })

    it('clears existing selection when add is false', () => {
      const store = useCollectionsStore()
      store.replaceItems({
        a: makeItem(1, true, t(0)),
        b: makeItem(2, true, t(5)),
        c: makeItem(3, true, t(20)),
      })

      store.selectByMinInterval(10, false)

      expect(store.itemsArray.map((i) => i.meta.selected)).toEqual([true, false, true])
    })

    it('keeps a pre-selected item that fails the interval check when add is true', () => {
      const store = useCollectionsStore()
      store.replaceItems({
        a: makeItem(1, false, t(0)),
        b: makeItem(2, true, t(5)),
      })

      store.selectByMinInterval(10, true)

      // b is 5s from a — fails the 10s threshold — but stays selected because add=true never deselects
      expect(store.itemsArray.map((i) => i.meta.selected)).toEqual([true, true])
    })

    it('adds to existing selection when add is true', () => {
      const store = useCollectionsStore()
      store.replaceItems({
        a: makeItem(1, false, t(0)),
        b: makeItem(2, true, t(5)),
        c: makeItem(3, false, t(12)),
      })

      store.selectByMinInterval(10, true)

      // a: selected (first); b: 5s skip but already selected stays; c: 12s from a >= 10 selected
      expect(store.itemsArray.map((i) => i.meta.selected)).toEqual([true, true, true])
    })
  })

  describe('selectByMinDistance', () => {
    it('always selects first item', () => {
      const store = useCollectionsStore()
      store.replaceItems({ a: pt(1, false, 0, 0) })

      store.selectByMinDistance(100, false)

      expect(store.itemsArray[0]!.meta.selected).toBe(true)
    })

    it('selects items meeting the minimum distance from last selected', () => {
      const store = useCollectionsStore()
      // ~0m, ~55m, ~111m, ~167m from origin
      store.replaceItems({
        a: pt(1, false, 0, 0),
        b: pt(2, false, 0, 0.0005),
        c: pt(3, false, 0, 0.001),
        d: pt(4, false, 0, 0.0015),
      })

      store.selectByMinDistance(100, false)

      // a: selected (first); b: ~55m from a, skip; c: ~111m from a, select; d: ~55m from c, skip
      expect(store.itemsArray.map((i) => i.meta.selected)).toEqual([true, false, true, false])
    })

    it('measures distance from last selected, not last checked', () => {
      const store = useCollectionsStore()
      store.replaceItems({
        a: pt(1, false, 0, 0),
        b: pt(2, false, 0, 0.0005),
        c: pt(3, false, 0, 0.0008),
        d: pt(4, false, 0, 0.0015),
      })

      store.selectByMinDistance(100, false)

      // b (~55m from a) and c (~88m from a) both rejected; d (~166m from a) accepted
      expect(store.itemsArray.map((i) => i.meta.selected)).toEqual([true, false, false, true])
    })

    it('clears existing selection when add is false', () => {
      const store = useCollectionsStore()
      store.replaceItems({
        a: pt(1, true, 0, 0),
        b: pt(2, true, 0, 0.0005),
        c: pt(3, true, 0, 0.001),
      })

      store.selectByMinDistance(100, false)

      expect(store.itemsArray.map((i) => i.meta.selected)).toEqual([true, false, true])
    })

    it('keeps pre-selected item that fails distance check when add is true', () => {
      const store = useCollectionsStore()
      store.replaceItems({
        a: pt(1, false, 0, 0),
        b: pt(2, true, 0, 0.0005),
      })

      store.selectByMinDistance(100, true)

      // b is ~55m from a — fails threshold — but stays selected because add=true never deselects
      expect(store.itemsArray.map((i) => i.meta.selected)).toEqual([true, true])
    })

    it('adds to existing selection when add is true', () => {
      const store = useCollectionsStore()
      store.replaceItems({
        a: pt(1, false, 0, 0),
        b: pt(2, true, 0, 0.0005),
        c: pt(3, false, 0, 0.0015),
      })

      store.selectByMinDistance(100, true)

      // a: selected (first); b: ~55m skip but stays; c: ~166m from a >= 100m, select
      expect(store.itemsArray.map((i) => i.meta.selected)).toEqual([true, true, true])
    })
  })

  describe('selectByTraversalDistance', () => {
    it('always selects first item', () => {
      const store = useCollectionsStore()
      store.replaceItems({ a: pt(1, false, 0, 0) })

      store.selectByTraversalDistance(100, false)

      expect(store.itemsArray[0]!.meta.selected).toBe(true)
    })

    it('selects item when traversal distance meets threshold', () => {
      const store = useCollectionsStore()
      // a→b = ~55m, a→b + b→c = ~110m >= 100m
      store.replaceItems({
        a: pt(1, false, 0, 0),
        b: pt(2, false, 0, 0.0005),
        c: pt(3, false, 0, 0.001),
      })

      store.selectByTraversalDistance(100, false)

      // a: first (selected); b: ~55m accumulated, skip; c: ~110m accumulated, select
      expect(store.itemsArray.map((i) => i.meta.selected)).toEqual([true, false, true])
    })

    it('accumulates across skipped points from last selected, not straight-line', () => {
      const store = useCollectionsStore()
      // a→b→c path is ~110m traversal; straight-line a→c is ~78m
      store.replaceItems({
        a: pt(1, false, 0, 0),
        b: pt(2, false, 0.0005, 0),
        c: pt(3, false, 0.0005, 0.0005),
      })

      store.selectByTraversalDistance(100, false)

      // traversal: a→b ~55m, b→c ~55m, total ~110m → c selected
      expect(store.itemsArray.map((i) => i.meta.selected)).toEqual([true, false, true])
    })

    it('resets accumulator after selection', () => {
      const store = useCollectionsStore()
      store.replaceItems({
        a: pt(1, false, 0, 0),
        b: pt(2, false, 0, 0.001),
        c: pt(3, false, 0, 0.0015),
      })

      store.selectByTraversalDistance(100, false)

      // a: selected; b: ~111m from a, select, reset; c: ~55m from b, skip
      expect(store.itemsArray.map((i) => i.meta.selected)).toEqual([true, true, false])
    })

    it('clears existing selection when add is false', () => {
      const store = useCollectionsStore()
      store.replaceItems({
        a: pt(1, true, 0, 0),
        b: pt(2, true, 0, 0.0005),
        c: pt(3, true, 0, 0.001),
      })

      store.selectByTraversalDistance(100, false)

      expect(store.itemsArray.map((i) => i.meta.selected)).toEqual([true, false, true])
    })

    it('keeps pre-selected item that fails threshold when add is true', () => {
      const store = useCollectionsStore()
      store.replaceItems({
        a: pt(1, false, 0, 0),
        b: pt(2, true, 0, 0.0005),
      })

      store.selectByTraversalDistance(100, true)

      // b is ~55m traversal from a — fails — but stays selected (add=true never deselects)
      expect(store.itemsArray.map((i) => i.meta.selected)).toEqual([true, true])
    })

    it('adds to existing selection when add is true', () => {
      const store = useCollectionsStore()
      store.replaceItems({
        a: pt(1, false, 0, 0),
        b: pt(2, true, 0, 0.0005),
        c: pt(3, false, 0, 0.001),
      })

      store.selectByTraversalDistance(100, true)

      // a: selected; b: ~55m traversal, fails but stays; c: ~110m traversal, select
      expect(store.itemsArray.map((i) => i.meta.selected)).toEqual([true, true, true])
    })
  })

  describe('selectUnuploaded', () => {
    it('selects items with no existing Commons file', () => {
      const store = useCollectionsStore()
      const notUploaded = makeItem(1)
      const uploaded = makeItem(2)
      uploaded.image.existing = [{ url: 'https://commons.wikimedia.org/wiki/File:Test.jpg' }]

      store.replaceItems({ 'item-1': notUploaded, 'item-2': uploaded })

      store.selectUnuploaded()

      expect(store.itemsArray.map((i) => i.meta.selected)).toEqual([true, false])
    })

    it('deselects previously selected items that have an existing Commons file', () => {
      const store = useCollectionsStore()
      const selected = makeItem(1, true)
      selected.image.existing = [{ url: 'https://commons.wikimedia.org/wiki/File:Test.jpg' }]
      const unselected = makeItem(2, false)

      store.replaceItems({ 'item-1': selected, 'item-2': unselected })

      store.selectUnuploaded()

      expect(store.itemsArray.map((i) => i.meta.selected)).toEqual([false, true])
    })
  })
})

describe('collections store — preset state', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('setActivePreset(id | null)', () => {
    it('sets currentPresetId to the given id', () => {
      const store = useCollectionsStore()
      store.setActivePreset(5)
      expect(store.currentPresetId).toBe(5)
    })

    it('clears currentPresetId when called with null', () => {
      const store = useCollectionsStore()
      store.setActivePreset(null)
      expect(store.currentPresetId).toBeNull()
    })

    it('clears currentPresetId after having set it', () => {
      const store = useCollectionsStore()
      store.setActivePreset(5)
      store.setActivePreset(null)
      expect(store.currentPresetId).toBeNull()
    })
  })

  describe('applyPreset integration', () => {
    it('copies all preset fields to global state', () => {
      const store = useCollectionsStore()
      const preset = makePreset({
        title_template: 'My {{mapillary.user.username}} template.jpg',
        labels: { language: 'de', value: 'German description' },
        categories: 'Cat1\nCat2',
        exclude_from_date_category: true,
      })
      store.applyPreset(preset)

      expect(store.globalTitleTemplate).toBe('My {{mapillary.user.username}} template.jpg')
      expect(store.globalLanguage).toBe('de')
      expect(store.globalDescription).toBe('German description')
      expect(store.globalCategories).toBe('Cat1\nCat2')
      expect(store.globalDateCategory).toBe(false) // inverted from exclude_from_date_category
    })

    it('sets currentPresetId after applyPreset', () => {
      const store = useCollectionsStore()
      store.applyPreset(makePreset({ id: 7 }))
      expect(store.currentPresetId).toBe(7)
    })
  })

  describe('$reset', () => {
    it('clears currentPresetId on reset', () => {
      const store = useCollectionsStore()
      store.setActivePreset(1)
      store.$reset()
      expect(store.currentPresetId).toBeNull()
    })
  })
})
