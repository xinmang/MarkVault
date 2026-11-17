import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BarChart3, Bot, User } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { ThemeToggle } from '@/components/common/ThemeToggle'
import { ColorThemeSelector } from '@/components/common/ColorThemeSelector'
import { useBuiltinPluginRunning } from '@/plugins/context'

// .btn 默认是块级盒子，图标会偏离中心；显示方式由各按钮自己给出（Agent 在手机宽度下隐藏）
const ICON_BUTTON =
  'btn btn-sm btn-ghost h-11 w-11 min-h-11 min-w-11 items-center justify-center p-2'
// 主题色工具类在本项目的 Tailwind 配置下不会生成，当前页的高亮直接使用主题变量
const ACTIVE_STYLE = {
  color: 'var(--primary)',
  background: 'oklch(from var(--primary) l c h / 0.1)',
}

/**
 * 登录后页头右侧的图标入口：主题、配色、Agent 与数据统计。
 * 手机宽度下底部导航已有 Agent，页头隐藏它为统计入口腾出位置。
 */
export function HeaderActions({ publicPage = false }: { publicPage?: boolean }) {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const location = useLocation()
  const onStatistics = location.pathname === '/statistics'
  const onAgent = location.pathname.startsWith('/agent')
  const agentEnabled = useBuiltinPluginRunning('agent')
  const statisticsEnabled = useBuiltinPluginRunning('statistics')

  return (
    <div className="flex items-center gap-1.5 sm:gap-2 md:gap-4">
      <ThemeToggle />
      <ColorThemeSelector />
      {(agentEnabled || publicPage) && (
        <button
          type="button"
          onClick={() => navigate(publicPage ? '/agent' : '/agent/chat')}
          className={`${ICON_BUTTON} hidden sm:inline-flex`}
          title={t('nav.agent')}
          aria-label={t('nav.agent')}
          style={onAgent ? ACTIVE_STYLE : undefined}
          aria-current={onAgent ? 'page' : undefined}
        >
          <Bot className="h-4 w-4" />
        </button>
      )}

      {statisticsEnabled && (
        <button
          type="button"
          onClick={() => navigate('/statistics')}
          className={`${ICON_BUTTON} inline-flex`}
          style={onStatistics ? ACTIVE_STYLE : undefined}
          title={t('nav.statistics')}
          aria-label={t('nav.statistics')}
          aria-current={onStatistics ? 'page' : undefined}
        >
          <BarChart3 className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

/** 设置入口固定在页头最外端（GitHub 之后），方便形成点击习惯。 */
export function HeaderSettingsButton() {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuthStore()
  if (!user) return null
  const onSettings = location.pathname.startsWith('/settings')

  return (
    <button
      type="button"
      onClick={() => navigate('/settings/general')}
      className={`${ICON_BUTTON} inline-flex`}
      style={onSettings ? ACTIVE_STYLE : undefined}
      title={t('nav.userSettings', { username: user.username })}
      aria-label={t('nav.userSettings', { username: user.username })}
      aria-current={onSettings ? 'page' : undefined}
    >
      <User className="h-4 w-4" />
    </button>
  )
}
