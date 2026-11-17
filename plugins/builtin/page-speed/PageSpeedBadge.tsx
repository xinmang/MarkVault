import { useContext, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { Gauge, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { featureSettingsPath } from '@/plugins/navigation'
import { useTranslation } from 'react-i18next'
import { PageSpeedContext } from './context'
import { formatLoadTime, type PageLoadTracker } from './metrics'
import './style.css'

export function PageSpeedBadge() {
  const tracker = useContext(PageSpeedContext)
  return tracker ? <ActiveBadge tracker={tracker} /> : null
}

function ActiveBadge({ tracker }: { tracker: PageLoadTracker }) {
  const { t } = useTranslation('plugins')
  const metrics = useSyncExternalStore(tracker.subscribe, tracker.getSnapshot, tracker.getSnapshot)
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const title = t('pageSpeed.' + (metrics.kind === 'document' ? 'document' : 'route'))
  const value =
    metrics.status === 'complete'
      ? formatLoadTime(metrics.duration)
      : t('pageSpeed.status.' + metrics.status)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        trigger.current?.focus()
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])
  return (
    <div ref={root} className="page-speed" data-status={metrics.status}>
      <button
        ref={trigger}
        type="button"
        className="page-speed__trigger"
        aria-label={title + '：' + value}
        title={t('pageSpeed.details')}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <Gauge size={13} aria-hidden="true" />
        <span className="page-speed__label">{title}</span>
        <strong>{value}</strong>
      </button>
      {open && (
        <section id={panelId} className="page-speed__panel" aria-label={t('pageSpeed.details')}>
          <div className="page-speed__heading">
            <h2>{t('pageSpeed.details')}</h2>
            <button
              type="button"
              aria-label={t('pageSpeed.close')}
              onClick={() => {
                setOpen(false)
                trigger.current?.focus()
              }}
            >
              <X size={16} />
            </button>
          </div>
          <dl>
            <div>
              <dt>{title}</dt>
              <dd>{value}</dd>
            </div>
            {metrics.kind === 'document' && (
              <>
                <div>
                  <dt>{t('pageSpeed.ttfb')}</dt>
                  <dd>{formatLoadTime(metrics.ttfb)}</dd>
                </div>
                <div>
                  <dt>{t('pageSpeed.domReady')}</dt>
                  <dd>{formatLoadTime(metrics.domReady)}</dd>
                </div>
                <div>
                  <dt>{t('pageSpeed.firstPaint')}</dt>
                  <dd>{formatLoadTime(metrics.firstPaint)}</dd>
                </div>
              </>
            )}
          </dl>
          <p>{t('pageSpeed.' + (metrics.kind === 'document' ? 'documentHint' : 'routeHint'))}</p>
          {metrics.status !== 'complete' && <p>{t('pageSpeed.explanation.' + metrics.status)}</p>}
          <Link to={featureSettingsPath('markvault.page-speed')} onClick={() => setOpen(false)}>
            {t('openSettings')}
          </Link>
        </section>
      )}
    </div>
  )
}
