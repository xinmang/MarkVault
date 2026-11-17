import { useEffect, useRef, useState } from 'react'
import { Pause, Play, RotateCcw, Terminal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useExperimentalFeatures } from '@/contexts/ExperimentalFeaturesContext'
import { useAuthStore } from '@/stores/authStore'
import type { SignalScene } from './signal-scene'

/** 独立画布复用 ASCII 鲨鱼渲染器，不读写全站海洋背景的状态。 */
export function AgentSignalScene() {
  const { t } = useTranslation('agent')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<SignalScene | null>(null)
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const authenticated = useAuthStore((state) => state.isAuthenticated)
  const { motion } = useExperimentalFeatures()
  const [paused, setPaused] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const staticScene = reducedMotion || (authenticated && !motion.enabled)
  const options = useRef({ paused, staticScene })

  useEffect(() => {
    options.current = { paused, staticScene }
    sceneRef.current?.configure(paused, staticScene)
  }, [paused, staticScene])

  useEffect(() => {
    let cancelled = false
    void import('./signal-scene')
      .then(({ createSignalScene }) => {
        if (cancelled || !canvasRef.current) return
        sceneRef.current = createSignalScene(canvasRef.current)
        sceneRef.current.configure(options.current.paused, options.current.staticScene)
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true)
      })
    return () => {
      cancelled = true
      sceneRef.current?.destroy()
      sceneRef.current = null
    }
  }, [])

  return (
    <figure className="agent-signal" aria-label={t('scene.description')}>
      <div className="agent-signal__bar">
        <span>
          <Terminal size={14} aria-hidden="true" /> ASCII / OCEAN
        </span>
        <span className="agent-signal__channel">SUBJECT_01</span>
      </div>
      <div className="agent-signal__viewport">
        <canvas ref={canvasRef} aria-hidden="true" />
        {unavailable && (
          <pre className="agent-signal__fallback" aria-hidden="true">
            ‹ · : = + # ▪ ▪ # + = : · ›
          </pre>
        )}
        <span className="agent-signal__coordinate" aria-hidden="true">
          01 / KNOWLEDGE OCEAN
        </span>
      </div>
      <figcaption className="agent-signal__footer">
        <span>
          <i aria-hidden="true" />
          {t(
            unavailable ? 'scene.unavailable' : staticScene || paused ? 'scene.still' : 'scene.live'
          )}
        </span>
        <div className="agent-signal__controls">
          <button
            type="button"
            disabled={staticScene || unavailable}
            aria-label={t(paused ? 'scene.play' : 'scene.pause')}
            title={t(paused ? 'scene.play' : 'scene.pause')}
            onClick={() => setPaused(!paused)}
          >
            {paused ? <Play size={14} /> : <Pause size={14} />}
          </button>
          <button
            type="button"
            disabled={staticScene || unavailable}
            aria-label={t('scene.replay')}
            title={t('scene.replay')}
            onClick={() => {
              setPaused(false)
              sceneRef.current?.replay()
            }}
          >
            <RotateCcw size={14} />
          </button>
        </div>
      </figcaption>
    </figure>
  )
}
