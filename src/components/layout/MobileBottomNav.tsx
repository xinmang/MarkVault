/**
 * 移动端底部导航栏组件
 * 提供移动端专用的导航体验
 */

import { useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BookOpen, Bot, Layers } from 'lucide-react'
import { Z_INDEX } from '@/lib/constants/z-index'
import { useBuiltinPluginRunning } from '@/plugins/context'

interface NavItem {
  id: string
  labelKey: string
  icon: React.ComponentType<{ className?: string }>
  path: string
  badge?: number
}

export function MobileBottomNav() {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const location = useLocation()
  const agentEnabled = useBuiltinPluginRunning('agent')

  const navItems: NavItem[] = [
    {
      id: 'bookmarks',
      labelKey: 'nav.bookmarks',
      icon: BookOpen,
      path: '/',
    },
    {
      id: 'tab-groups',
      labelKey: 'nav.tabGroups',
      icon: Layers,
      path: '/tab',
    },
    {
      id: 'agent',
      labelKey: 'nav.agent',
      icon: Bot,
      path: '/agent/chat',
    },
  ]

  const visibleItems = navItems.filter((item) => item.id !== 'agent' || agentEnabled)
  const isActive = (path: string) => {
    if (path === '/') {
      return location.pathname === '/'
    }
    return location.pathname === path || location.pathname.startsWith(path + '/')
  }

  return (
    // 背景、分隔线与当前项高亮写在 .mobile-bottom-nav 中：主题色工具类（bg-card、text-primary）在本项目不生成
    <nav
      className="mobile-bottom-nav fixed bottom-0 left-0 right-0 sm:hidden"
      style={{ zIndex: Z_INDEX.MOBILE_BOTTOM_NAV }}
    >
      <div
        className="grid h-16"
        style={{ gridTemplateColumns: 'repeat(' + visibleItems.length + ', minmax(0, 1fr))' }}
      >
        {visibleItems.map((item) => {
          const Icon = item.icon
          const active = isActive(item.path)

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(item.path)}
              className="mobile-bottom-nav__item flex flex-col items-center justify-center space-y-1 px-2 py-2 touch-manipulation"
              aria-current={active ? 'page' : undefined}
            >
              <div className="relative">
                <Icon className="h-5 w-5" />
                {item.badge && item.badge > 0 && (
                  <span className="absolute -top-1 -right-1 h-4 w-4 bg-destructive text-destructive-foreground text-xs rounded-full flex items-center justify-center">
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                )}
              </div>
              <span className="text-xs font-medium">{t(item.labelKey)}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
