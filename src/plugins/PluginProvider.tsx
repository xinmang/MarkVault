import { useEffect, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { pluginAPI } from './api'
import { PluginContext } from './context'
import { DocumentTheme } from '@/components/layout/DocumentTheme'

export function PluginProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.user)
  const location = useLocation()
  const safe = new URLSearchParams(location.search).get('safe') === '1'
  const publicPage = location.pathname.startsWith('/share/') || !user
  const query = useQuery({
    queryKey: ['plugins', user?.id],
    queryFn: pluginAPI.list,
    enabled: !publicPage,
    staleTime: 15_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  })
  const directory = publicPage ? undefined : query.data
  useEffect(() => {
    if (!directory || safe || publicPage) return
    const selectors = { cards: '.bookmark-card', buttons: '.btn', tags: '.tag-item' }
    const frames: Record<string, Keyframe[]> = {
      fade: [{ opacity: 0.5 }, { opacity: 1 }],
      rise: [{ transform: 'translateY(6px)' }, { transform: 'translateY(0)' }],
      pulse: [{ opacity: 0.7 }, { opacity: 1 }],
    }
    const animations = new Set<Animation>()
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const root = document.documentElement
    const clear = () => {
      for (const animation of animations) animation.cancel()
      animations.clear()
    }
    const handler = (event: PointerEvent) => {
      if (
        reduced.matches ||
        root.getAttribute('data-motion') !== 'on' ||
        !(event.target instanceof Element)
      )
        return
      for (const p of directory.plugins) {
        if (p.origin === 'builtin' || p.status !== 'running') continue
        for (const c of p.manifest.contributes) {
          if (c.kind !== 'motion' || !c.animation) continue
          const target = event.target.closest(selectors[c.animation.target])
          if (!target || animations.size >= 20) continue
          const animation = target.animate(frames[c.animation.effect] ?? [], {
            duration: c.animation.duration,
            easing: 'ease-out',
          })
          animations.add(animation)
          animation.onfinish = () => animations.delete(animation)
        }
      }
    }
    const observer = new MutationObserver(() => {
      if (root.getAttribute('data-motion') !== 'on') clear()
    })
    observer.observe(root, { attributes: true, attributeFilter: ['data-motion'] })
    document.addEventListener('pointerover', handler)
    reduced.addEventListener('change', clear)
    return () => {
      document.removeEventListener('pointerover', handler)
      reduced.removeEventListener('change', clear)
      observer.disconnect()
      clear()
    }
  }, [directory, safe, publicPage])
  useEffect(() => {
    if (!directory || safe || publicPage) return
    const theme = directory.plugins.find(
      (item) =>
        item.origin !== 'builtin' &&
        item.status === 'running' &&
        item.manifest.contributes.some((c) => c.kind === 'theme')
    )
    if (!theme) return
    const root = document.documentElement
    const previous = new Map<string, string>()
    for (const contribution of theme.manifest.contributes) {
      if (contribution.kind !== 'theme') continue
      for (const [key, value] of Object.entries(contribution.tokens ?? {})) {
        if (
          !/^--[a-z][a-z0-9-]{0,60}$/.test(key) ||
          !/^[a-zA-Z0-9#(),.% /-]{1,120}$/.test(value) ||
          /url/i.test(value)
        )
          continue
        previous.set(key, root.style.getPropertyValue(key))
        root.style.setProperty(key, value)
      }
    }
    return () => {
      for (const [key, value] of previous) {
        if (value) root.style.setProperty(key, value)
        else root.style.removeProperty(key)
      }
    }
  }, [directory, safe, publicPage])
  return (
    <PluginContext.Provider
      value={{
        directory,
        safe,
        ready: query.isSuccess && !publicPage,
        refresh: async () => {
          await queryClient.invalidateQueries({ queryKey: ['preferences'] })
          return query.refetch()
        },
      }}
    >
      <DocumentTheme />
      {children}
    </PluginContext.Provider>
  )
}
