import { useRef } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BookOpen, Layers } from 'lucide-react'
import { MobileBottomNav } from '@/components/layout/MobileBottomNav'
import { ThemedRoot } from '@/components/layout/ThemedRoot'
import { ShellHeader } from '@/components/layout/ShellHeader'
import { HeaderActions, HeaderSettingsButton } from '@/components/layout/HeaderActions'
import { usePageTransition } from '@/hooks/usePageTransition'

export function AppShell() {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const location = useLocation()

  const isOnTabGroupsPage = location.pathname.startsWith('/tab')
  const mainRef = useRef<HTMLElement>(null)
  usePageTransition(mainRef)

  const handleToggleView = () => {
    if (isOnTabGroupsPage) {
      navigate('/')
    } else {
      navigate('/tab')
    }
  }

  return (
    <ThemedRoot>
      <ShellHeader
        subtitle={isOnTabGroupsPage ? t('nav.manageTabGroups') : t('nav.smartBookmarkManagement')}
        onHome={() => navigate('/')}
        onLogoClick={handleToggleView}
        logoTitle={isOnTabGroupsPage ? t('nav.switchToBookmarks') : t('nav.switchToTabGroups')}
        logoIcon={
          isOnTabGroupsPage ? (
            <BookOpen className="w-5 h-5 sm:w-7 sm:h-7 text-foreground" />
          ) : (
            <Layers className="w-5 h-5 sm:w-7 sm:h-7 text-foreground" />
          )
        }
        right={<HeaderActions />}
        trailing={<HeaderSettingsButton />}
      />

      <main ref={mainRef} className="app-main w-full pb-16 sm:pb-6 pt-3 sm:pt-6 flex flex-col min-h-0 flex-1 bg-muted/30">
        <div className="mx-auto w-full px-3 sm:px-6">
          <Outlet />
        </div>
      </main>

      <MobileBottomNav />
    </ThemedRoot>
  )
}
