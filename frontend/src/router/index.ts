import MapillaryCollections from '@frontend/components/mapillary/MapillaryCollections.vue'
import AdminView from '@frontend/components/views/AdminView.vue'
import BatchesView from '@frontend/components/views/BatchesView.vue'
import BatchUploadsView from '@frontend/components/views/BatchUploadsView.vue'
import FailedUploadsView from '@frontend/components/views/FailedUploadsView.vue'
import MaintenanceView from '@frontend/components/views/MaintenanceView.vue'
import { useAuthStore } from '@frontend/stores/auth.store'
import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    redirect: '/mapillary',
  },
  {
    path: '/mapillary',
    name: 'mapillary',
    component: MapillaryCollections,
  },
  {
    path: '/batches',
    name: 'batches',
    component: BatchesView,
  },
  {
    path: '/batches/:id',
    name: 'batch-details',
    component: BatchUploadsView,
    props: true,
  },
  {
    path: '/admin',
    name: 'admin',
    component: AdminView,
  },
  {
    path: '/admin/failed-uploads',
    name: 'admin-failed-uploads',
    component: FailedUploadsView,
  },
  {
    path: '/maintenance',
    name: 'maintenance',
    component: MaintenanceView,
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (!auth.isChecked) {
    await auth.checkAuth()
  }
  if (auth.maintenance && !auth.isAdmin && to.name !== 'maintenance') {
    return { name: 'maintenance' }
  }
})

export default router
