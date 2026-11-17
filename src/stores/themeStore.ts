import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { resolveOceanBackground, type OceanBackgroundMode } from '@/lib/ocean-background'

type Theme = 'light' | 'dark'
export type ColorTheme = 'default' | 'blue' | 'green' | 'orange' | 'violet'

interface ThemeStore {
  theme: Theme
  colorTheme: ColorTheme
  oceanBackground: OceanBackgroundMode
  isAutoTheme: boolean
  setTheme: (theme: Theme) => void
  setColorTheme: (colorTheme: ColorTheme) => void
  setOceanBackground: (mode: OceanBackgroundMode) => void
  toggleTheme: () => void
}

const getSystemTheme = (): Theme => {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      theme: getSystemTheme(),
      colorTheme: 'default',
      oceanBackground: 'off',
      isAutoTheme: true,
      setTheme: (theme) => set({ theme, isAutoTheme: false }),
      setColorTheme: (colorTheme) => set({ colorTheme }),
      setOceanBackground: (mode) => set({ oceanBackground: resolveOceanBackground(mode) }),
      toggleTheme: () =>
        set((state) => ({
          theme: state.theme === 'light' ? 'dark' : 'light',
          isAutoTheme: false,
        })),
    }),
    {
      name: 'theme-storage',
    }
  )
)

if (typeof window !== 'undefined') {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  const handleThemeChange = (e: MediaQueryListEvent) => {
    if (useThemeStore.getState().isAutoTheme) {
      useThemeStore.setState({ theme: e.matches ? 'dark' : 'light' })
    }
  }

  if (mediaQuery.addEventListener) {
    mediaQuery.addEventListener('change', handleThemeChange)
  } else {
    mediaQuery.addListener(handleThemeChange)
  }
}
