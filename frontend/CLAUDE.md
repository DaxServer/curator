## Non-Obvious Gotchas

**`useRouteParams` with numeric params:** `useRouteParams<number>('id')` lies at runtime — Vue Router params are always strings. Use `useRouteParams('id', 0, { transform: Number })` to get an actual number.

**Elysia WS body has no coercion:** Unlike HTTP query/params (which Elysia 1.1 coerces), WS body is parsed from JSON which preserves types — a string `"367"` won't match `t.Integer()`. Fix type mismatches at the source (e.g. `useRouteParams` transform).

**Auto-imports:** `.vue` SFCs get Vite's auto-import transform; `.ts` composable files do not — must explicitly import `ref`, `watch`, stores, and PrimeVue utilities like `useToast`.

**Auto-imports regeneration:** After adding a composable or store, regenerate `auto-imports.d.ts` and `components.d.ts` by running `bunx vite build` in `frontend/`, then commit the updated files and delete `dist/`.

**asyncapi.json generator type inference:** `bun generate` uses `tsc` to infer template literal types. If types degrade to `string` after a dep bump, a new TypeScript error is polluting `tsc` output — add a suppression flag in `getInferredType()` in `scripts/asyncapi.ts`.

**`onScopeDispose` not `onUnmounted` in composables:** Works in both component and bare `effectScope` (tests). Explicitly import from `'vue'` even if it appears in `auto-imports.d.ts`.

## Testing

**`mock.module` must precede imports:** `mock.module(...)` must appear before any import of the module under test. Import the composable dynamically (`await import(...)`) inside `beforeEach` after `mock.restore()`.

**Watcher flush:** Default watcher flush is async (microtask). If test sets a ref and immediately asserts on watcher output, use `{ flush: 'sync' }` on the watcher.

**Composable scope:** Composables calling `watch()` must run inside `effectScope` to prevent test leaks:
```ts
let scope = effectScope()
beforeEach(() => { scope = effectScope() })
afterEach(() => { scope.stop() })
const run = () => scope.run(() => useMyComposable())!
```

**Module-level singleton state:** Composables with module-level `ref` retain state across tests — reset explicitly in `beforeEach`.

**POST body assertions:** Use `new URLSearchParams(rawBody).get('key')` — raw body encodes spaces as `+` so `.toContain('foo bar')` won't match.

**Lazy DataView filtering:** Use `v-show` on rows, not filtering the `:value` array — changing `:value` on a `lazy` DataView corrupts pagination state.

## PrimeVue

**DataTable Noir theme header:** Don't set `sort-field`/`sort-order` props unless black header is intentional (pre-selection triggers `selectedBackground`). Override header colors via component tokens in `src/assets/Noir.ts` — CSS selectors can't beat PrimeVue's inline token injection.

**DatePicker events:** Use `@update:model-value` as the single handler — `@date-select` and `@clear` are unreliable (`@clear` may not fire with `show-clear`).

**Button hover CSS:** PrimeVue injects button CSS at runtime after static styles — add `!important` to `:deep()` hover rules. (Unlike DataTable which uses inline tokens where `!important` can't win.)

**PrimeVue mocks in tests:** `useToast` and similar utilities must be mocked before any import that depends on them:
```ts
mock.module('primevue/usetoast', () => ({ useToast: () => ({ add: mock(() => {}) }) }))
```

## MapLibre GL JS

- Reference container by string `id`, not Vue `ref` — MapLibre reads `clientHeight` before Vue refs resolve
- Set height via scoped CSS — MapLibre reads `clientHeight` at init before Tailwind JIT resolves
- Paint expressions are WebGL-based — CSS `var()` not supported, hardcode hex values
- `positron` style is cleaner than the default `liberty` (which has missing sprite warnings)

## Wikimedia Commons

- `action=query&titles=` accepts max 50 titles for non-bot users (500 with `apihighlimits`)
