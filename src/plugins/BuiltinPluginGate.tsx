import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Puzzle } from 'lucide-react'
import { useBuiltinPluginRunning, usePlugins } from './context'
import { featureSettingsPath } from './navigation'

/** 功能关闭后卸载功能页面，既隐藏入口，也停止页面内的数据查询。 */
export function BuiltinPluginGate({ id, children }: { id: string; children: ReactNode }) {
  const { t } = useTranslation('plugins')
  const { ready, safe } = usePlugins()
  const running = useBuiltinPluginRunning(id)
  if (running) return children
  if (!ready && !safe)
    return (
      <p role="status" className="p-6 text-sm text-muted-foreground">
        {t('loading')}
      </p>
    )
  return (
    <section className="mx-auto max-w-xl rounded-xl border border-border bg-card p-6 space-y-3">
      <Puzzle className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
      <h1 className="text-lg font-semibold">{t('featureUnavailable')}</h1>
      <p className="text-sm text-muted-foreground">{t('featureUnavailableHint')}</p>
      <Link className="btn btn-sm btn-secondary" to={featureSettingsPath('markvault.' + id, safe)}>
        {t('openSettings')}
      </Link>
    </section>
  )
}
