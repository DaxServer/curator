import { PrimeVueResolver } from '@primevue/auto-import-resolver'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import type { PluginOption } from 'vite'
import { defineConfig } from 'vite'
import vueDevTools from 'vite-plugin-vue-devtools'

export default defineConfig((): import('vite').UserConfig => {
  return {
    clearScreen: false,
    plugins: [
      vue(),
      vueDevTools(),
      tailwindcss(),
      AutoImport({
        imports: [
          'vue',
          'pinia',
          'vue-router',
          '@vueuse/core',
          {
            from: '@vueuse/router',
            imports: ['useRouteParams'],
          },
          {
            from: 'primevue',
            imports: ['MeterItem'],
            type: true,
          },
          {
            from: 'primevue/datatable',
            imports: ['DataTableCellEditCompleteEvent', 'DataTablePageEvent'],
            type: true,
          },
          {
            from: 'primevue/dataview',
            imports: ['DataViewPageEvent'],
            type: true,
          },
          {
            from: 'primevue/message',
            imports: ['MessageProps'],
            type: true,
          },
          {
            from: 'primevue/useconfirm',
            imports: ['useConfirm'],
          },
          {
            from: 'primevue/usetoast',
            imports: ['useToast'],
          },
          {
            from: '@primevue/core/api',
            imports: ['FilterMatchMode'],
          },
          {
            from: 'ts-debounce',
            imports: ['debounce'],
          },
        ],
        dts: true,
        vueTemplate: true,
        biomelintrc: {
          enabled: true,
          filepath: './.biomelintrc-auto-import.json',
        },
      }),
      Components({
        dirs: ['src/**'],
        extensions: ['vue'],
        deep: true,
        dts: true,
        resolvers: [PrimeVueResolver()],
      }),
    ] as PluginOption[],
    server: {
      port: 5173,
      proxy: {
        '/auth': {
          target: 'http://localhost:8000',
          changeOrigin: true,
          secure: false,
        },
        '/api': {
          target: 'http://localhost:8000',
          changeOrigin: true,
          secure: false,
        },
        '/callback/wikimedia': {
          target: 'http://localhost:8000',
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/callback\/wikimedia/, '/auth/callback'),
        },
        '/ws': {
          target: 'ws://localhost:8000',
          changeOrigin: true,
          ws: true,
        },
      },
    },
    resolve: {
      tsconfigPaths: true,
    },
  }
})
