import { api } from '@frontend/lib/apiClient'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<string>('')
  const userid = ref<string>('')
  const isAuthenticated = computed(() => !!user.value)
  const isAuthorized = ref(false)
  const isLoading = ref(false)
  const isMock = ref(false)
  const isAdmin = computed(() => user.value === 'DaxServer')
  const maintenance = ref(false)

  const reset = () => {
    user.value = ''
    userid.value = ''
    isAuthorized.value = false
    isMock.value = false
    maintenance.value = false
  }

  const login = () => {
    isLoading.value = true
    window.location.href = '/auth/login'
  }

  const logout = async () => {
    try {
      await api.auth.logout.get()
      reset()
    } catch (error) {
      console.error('Logout failed:', error)
    } finally {
      isLoading.value = false
    }
  }

  const checkAuth = async () => {
    isLoading.value = true
    try {
      const { data, status } = await api.auth.whoami.get()
      if (status === 200 && data) {
        user.value = data.username
        userid.value = data.userid
        isAuthorized.value = data.authorized
        isMock.value = data.isMock
        maintenance.value = data.maintenance
      } else {
        reset()
      }
    } catch (error) {
      console.error('Authentication check failed:', error)
      reset()
    } finally {
      isLoading.value = false
    }
  }

  return {
    isAuthenticated,
    isAuthorized,
    isLoading,
    isMock,
    maintenance,
    user,
    userid,
    isAdmin,
    login,
    logout,
    checkAuth,
  }
})
