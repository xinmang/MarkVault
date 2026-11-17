import { Outlet, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LogIn } from 'lucide-react'
import { ThemedRoot } from '@/components/layout/ThemedRoot'
import { ShellHeader } from '@/components/layout/ShellHeader'
import { HeaderActions, HeaderSettingsButton } from '@/components/layout/HeaderActions'
import { useAuthStore } from '@/stores/authStore'

export function PublicAppShell() {
  const { t } = useTranslation(['common', 'agent'])
  const navigate = useNavigate()
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)

  return (
    <ThemedRoot className="public-app-shell">
      <ShellHeader
        subtitle={t('nav.smartBookmarkManagement')}
        onHome={() => navigate('/')}
        right={<HeaderActions publicPage={!isAuthenticated} />}
        trailing={
          isAuthenticated ? (
            <HeaderSettingsButton />
          ) : (
            <button
              type="button"
              onClick={() => navigate('/login')}
              className="btn btn-sm btn-ghost inline-flex h-11 w-11 min-h-11 min-w-11 items-center justify-center p-2"
              title={t('action.login')}
              aria-label={t('action.login')}
            >
              <LogIn className="h-4 w-4" />
            </button>
          )
        }
      />

      <main className="app-main w-full min-w-0 overflow-x-hidden px-3 sm:px-6">
        <div className="mx-auto min-w-0 max-w-full">
          <Outlet />
        </div>
      </main>
    </ThemedRoot>
  )
}
