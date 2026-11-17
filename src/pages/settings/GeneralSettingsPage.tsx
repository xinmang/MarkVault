import { useState, useEffect, useMemo, useRef } from 'react'
import { PluginSlot } from '@/plugins/PluginSlot'
import { usePlugins } from '@/plugins/context'
import { pluginAPI } from '@/plugins/api'
import { useDefaultManagementTheme } from '@/components/settings/useDefaultManagementTheme'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Zap,
  Key,
  Share2,
  Database,
  LogOut,
  UserRound,
  Bot,
  Palette,
  Globe,
  Sparkles,
  WandSparkles,
  Cable,
  BarChart3,
  Puzzle,
  LayoutGrid,
  Terminal,
  Droplets,
} from 'lucide-react'
import { RelatedPlugins } from '@/components/settings/RelatedPlugins'
import { CustomPluginsSection } from '@/components/settings/CustomPluginsSection'
import {
  ImageHostingPanel,
  McpClientPanel,
  ModelProviderPanel,
} from '@/components/settings/FeaturePanels'
import { SettingsSection } from '@/components/settings/SettingsSection'
import { PluginSettingsForm } from '@/plugins/PluginSettingsForm'
import { BrowserExtensionDownload } from '@/pages/extension/BrowserExtensionDownload'
import { PalettePluginSettings } from '@/components/settings/PalettePluginSettings'
import { ThemeTransitionSettings } from '@/components/settings/ThemeTransitionSettings'
import { isPluginRunning } from '@/plugins/navigation'
import { usePreferences, useUpdatePreferences } from '@/hooks/usePreferences'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import type { UserPreferences } from '@/lib/types'
import { ApiError } from '@/lib/api-client'
import { SettingsNav, type SettingsNavGroup } from '@/components/settings/SettingsNav'
import { SettingsSaveBar } from '@/components/settings/SettingsSaveBar'
import { BasicSettingsTab } from '@/components/settings/tabs/BasicSettingsTab'
import { AutomationSettingsTab } from '@/components/settings/tabs/AutomationSettingsTab'
import { SnapshotSettingsTab } from '@/components/settings/tabs/SnapshotSettingsTab'
import { ApiSettingsTab } from '@/components/settings/tabs/ApiSettingsTab'
import { ShareSettingsTab } from '@/components/settings/tabs/ShareSettingsTab'
import { DataSettingsTab } from '@/components/settings/tabs/DataSettingsTab'
import { ExperimentalSettingsTab } from '@/components/settings/tabs/ExperimentalSettingsTab'
import { TagDisplaySettings } from '@/components/settings/TagDisplaySettings'
import { ThemeSettingsTab, type InterfaceTheme } from '@/components/settings/tabs/ThemeSettingsTab'
import { ShellPicker } from '../../../plugins/builtin/shells/ShellPicker'
import { CanvasModeSettings } from '../../../plugins/builtin/canvas/CanvasModeSettings'
import { LiquidGlassPlayground } from '../../../plugins/builtin/liquid-glass/LiquidGlassPlayground'
import { resolveLiquidGlassConfig } from '../../../plugins/builtin/liquid-glass/settings'
import { SiteSettingsTab } from '@/components/settings/tabs/SiteSettingsTab'
import {
  MotionPluginSettings,
  OceanBackgroundSettings,
} from '@/components/settings/tabs/MotionSettingsTab'
import {
  useAppearancePreview,
  useExperimentalFeatures,
  type AppearancePreview,
} from '@/contexts/ExperimentalFeaturesContext'
import { MOTION_PREFERENCE_KEYS, resolveMotionSettings } from '@/lib/motion'
import { resolveOceanBackground, resolveOceanBackgroundScope } from '@/lib/ocean-background'

import { mergePreferencesDraft } from '@/lib/preferences-draft'

const EDITABLE_PREFERENCE_KEYS: (keyof UserPreferences)[] = [
  'show_tag_icons',
  'page_size',
  'bookmark_initial_count',
  'bookmark_load_more_expiry_minutes',
  'enable_search_auto_clear',
  'search_auto_clear_seconds',
  'enable_tag_selection_auto_clear',
  'tag_selection_auto_clear_seconds',
  'snapshot_retention_count',
  'experimental_vibehub_theme_enabled',
  'experimental_uiux_pro_theme_enabled',
  'experimental_ascii_theme_enabled',
  'experimental_liquid_glass_theme_enabled',
  'experimental_tag_heat_enabled',
  'experimental_tag_heat_style',
  'experimental_tag_heat_effect',
  'experimental_tag_heat_color',
  'experimental_tag_heat_intensity',
  'experimental_url_privacy_enabled',
  'experimental_url_privacy_effect',
  'experimental_url_privacy_strength',
  'experimental_hover_card_enabled',
  'experimental_hover_card_theme',
  'experimental_hover_card_effect',
  'experimental_hover_card_accent_color',
  'experimental_hover_card_intensity',
  'experimental_hover_card_size',
  'experimental_hover_card_delay',
  'experimental_hover_card_advanced_clicks',
  'experimental_hover_card_collector_clicks',
  'experimental_hover_card_secret_clicks',
  'experimental_hover_card_shuffle_enabled',
  ...MOTION_PREFERENCE_KEYS,
  'ocean_background_scope',
  'ocean_background',
]

const VALID_SECTIONS = [
  'theme',
  'layouts',
  'motion',
  'automation',
  'site',
  'ai',
  'api',
  'share',
  'data',
  'basic',
  'enhancements',
  'connections',
  'statistics',
  'plugins',
] as const
type SectionId = (typeof VALID_SECTIONS)[number]

function isValidSection(s: string | null): s is SectionId {
  return s !== null && (VALID_SECTIONS as readonly string[]).includes(s)
}

export function GeneralSettingsPage() {
  const { t } = useTranslation('settings')
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: preferences, isLoading } = usePreferences()
  const updatePreferences = useUpdatePreferences({ requireServer: true })
  const { user, logout } = useAuthStore()
  const { addToast } = useToastStore()
  const compact = useDefaultManagementTheme()
  const { directory, refresh: refreshPlugins, safe } = usePlugins()
  const asciiPlugin = directory?.plugins.find((plugin) => plugin.manifest.id === 'markvault.ascii')
  const glassPlugin = directory?.plugins.find(
    (plugin) => plugin.manifest.id === 'markvault.liquid-glass'
  )
  const { motion } = useExperimentalFeatures()
  const classicPlugin = directory?.plugins.find(
    (plugin) => plugin.manifest.id === 'markvault.classic'
  )
  const [themeDraft, setThemeDraft] = useState<InterfaceTheme | null>(null)
  const [isSavingTheme, setIsSavingTheme] = useState(false)
  const [isUpdatingPlugin, setIsUpdatingPlugin] = useState(false)

  const sectionFromUrl = searchParams.get('section')
  // 保留旧分类链接：视觉实验归入浏览增强，快照归入数据。
  const resolvedSection =
    sectionFromUrl === 'experimental'
      ? 'enhancements'
      : sectionFromUrl === 'snapshot'
        ? 'data'
        : sectionFromUrl
  const activeSection: SectionId = isValidSection(resolvedSection) ? resolvedSection : 'theme'
  const [localPreferences, setLocalPreferences] = useState<UserPreferences | null>(null)

  const savedInterfaceTheme: InterfaceTheme = preferences?.experimental_liquid_glass_theme_enabled
    ? 'liquid-glass'
    : preferences?.experimental_ascii_theme_enabled
      ? 'ascii'
      : preferences?.experimental_uiux_pro_theme_enabled
        ? 'uiux-pro'
        : preferences?.experimental_vibehub_theme_enabled
          ? 'vibehub'
          : classicPlugin?.status === 'running'
            ? 'classic'
            : 'default'
  const interfaceTheme = themeDraft ?? savedInterfaceTheme

  const previousPreferencesRef = useRef<UserPreferences | null>(null)
  useEffect(() => {
    if (!preferences) return
    const previous = previousPreferencesRef.current
    previousPreferencesRef.current = preferences
    setLocalPreferences((current) =>
      mergePreferencesDraft(previous, current, preferences, EDITABLE_PREFERENCE_KEYS)
    )
  }, [preferences])

  // 动效与海洋账号设置均可预览，未保存离开时恢复账号原值。
  const appearanceDraft = useMemo<AppearancePreview | null>(() => {
    if (!localPreferences) return null
    const settings = resolveMotionSettings(localPreferences)
    return {
      motion_enabled: settings.enabled,
      ocean_background_scope: resolveOceanBackgroundScope(localPreferences.ocean_background_scope),
      ocean_background: resolveOceanBackground(localPreferences.ocean_background),
    }
  }, [localPreferences])
  useAppearancePreview(appearanceDraft)

  // 同步 URL query param
  const handleSectionChange = (sectionId: string) => {
    if (isValidSection(sectionId)) {
      setSearchParams(sectionId === 'theme' ? {} : { section: sectionId }, { replace: true })
    }
  }

  const handleUpdate = (updates: Partial<UserPreferences>) => {
    setLocalPreferences((current) => (current ? { ...current, ...updates } : current))
  }

  const handleInterfaceThemeChange = (theme: InterfaceTheme) => {
    setThemeDraft(theme)
    handleUpdate({
      experimental_vibehub_theme_enabled: theme === 'vibehub',
      experimental_uiux_pro_theme_enabled: theme === 'uiux-pro',
      experimental_ascii_theme_enabled: theme === 'ascii',
      experimental_liquid_glass_theme_enabled: theme === 'liquid-glass',
    })
  }

  // 判断当前可编辑设置是否有未保存修改
  const isDirty = useMemo(() => {
    if (!preferences || !localPreferences) return false

    return (
      (themeDraft !== null && themeDraft !== savedInterfaceTheme) ||
      EDITABLE_PREFERENCE_KEYS.some((k) => preferences[k] !== localPreferences[k])
    )
  }, [preferences, localPreferences, themeDraft, savedInterfaceTheme])

  const handleSave = async () => {
    if (!localPreferences) return
    setIsSavingTheme(true)
    try {
      const saved = await updatePreferences.mutateAsync({
        theme: localPreferences.theme,
        page_size: localPreferences.page_size,
        bookmark_initial_count: localPreferences.bookmark_initial_count,
        bookmark_load_more_expiry_minutes: localPreferences.bookmark_load_more_expiry_minutes,
        view_mode: localPreferences.view_mode,
        density: localPreferences.density,
        tag_layout: localPreferences.tag_layout,
        show_tag_icons: localPreferences.show_tag_icons,
        sort_by: localPreferences.sort_by,
        search_auto_clear_seconds: localPreferences.search_auto_clear_seconds,
        tag_selection_auto_clear_seconds: localPreferences.tag_selection_auto_clear_seconds,
        enable_search_auto_clear: localPreferences.enable_search_auto_clear,
        enable_tag_selection_auto_clear: localPreferences.enable_tag_selection_auto_clear,
        snapshot_retention_count: localPreferences.snapshot_retention_count,
        experimental_vibehub_theme_enabled: localPreferences.experimental_vibehub_theme_enabled,
        experimental_uiux_pro_theme_enabled: localPreferences.experimental_uiux_pro_theme_enabled,
        experimental_ascii_theme_enabled: localPreferences.experimental_ascii_theme_enabled,
        experimental_liquid_glass_theme_enabled:
          localPreferences.experimental_liquid_glass_theme_enabled,
        experimental_tag_heat_enabled: localPreferences.experimental_tag_heat_enabled,
        experimental_tag_heat_style: localPreferences.experimental_tag_heat_style,
        experimental_tag_heat_effect: localPreferences.experimental_tag_heat_effect,
        experimental_tag_heat_color: localPreferences.experimental_tag_heat_color,
        experimental_tag_heat_intensity: localPreferences.experimental_tag_heat_intensity,
        experimental_url_privacy_enabled: localPreferences.experimental_url_privacy_enabled,
        experimental_url_privacy_effect: localPreferences.experimental_url_privacy_effect,
        experimental_url_privacy_strength: localPreferences.experimental_url_privacy_strength,
        experimental_hover_card_enabled: localPreferences.experimental_hover_card_enabled,
        experimental_hover_card_theme: localPreferences.experimental_hover_card_theme,
        experimental_hover_card_effect: localPreferences.experimental_hover_card_effect,
        experimental_hover_card_accent_color: localPreferences.experimental_hover_card_accent_color,
        experimental_hover_card_intensity: localPreferences.experimental_hover_card_intensity,
        experimental_hover_card_size: localPreferences.experimental_hover_card_size,
        experimental_hover_card_delay: localPreferences.experimental_hover_card_delay,
        experimental_hover_card_advanced_clicks:
          localPreferences.experimental_hover_card_advanced_clicks,
        experimental_hover_card_collector_clicks:
          localPreferences.experimental_hover_card_collector_clicks,
        experimental_hover_card_secret_clicks:
          localPreferences.experimental_hover_card_secret_clicks,
        experimental_hover_card_shuffle_enabled:
          localPreferences.experimental_hover_card_shuffle_enabled,
        ...appearanceDraft,
      })
      if (
        themeDraft !== null &&
        classicPlugin &&
        classicPlugin.enabled !== (themeDraft === 'classic')
      ) {
        await pluginAPI.save(
          classicPlugin,
          themeDraft === 'classic',
          classicPlugin.config,
          classicPlugin.grants
        )
      }
      await refreshPlugins()
      setThemeDraft(null)
      setLocalPreferences(saved)
      addToast('success', t('message.saveSuccess'))
    } catch (error) {
      let message = t('message.saveFailed')
      if (error instanceof ApiError && error.message) {
        message = t('message.saveFailedWithError', { error: error.message })
      }
      addToast('error', message)
    } finally {
      setIsSavingTheme(false)
    }
  }

  const handleDiscard = () => {
    setThemeDraft(null)
    if (preferences) {
      setLocalPreferences(preferences)
    }
  }

  const handleLogout = async () => {
    try {
      await logout()
      // 退出期间可能已经登录了新账号，此时不要强行跳转登录页
      if (!useAuthStore.getState().isAuthenticated) {
        navigate('/login')
      }
    } catch {
      addToast('error', t('message.logoutFailed'))
    }
  }

  const navGroups: SettingsNavGroup[] = useMemo(
    () => [
      {
        label: t('organization.core'),
        items: [
          { id: 'basic', label: t('tabs.basic'), icon: UserRound },
          { id: 'automation', label: t('tabs.automation'), icon: Zap },
          { id: 'data', label: t('tabs.data'), icon: Database },
          { id: 'share', label: t('tabs.share'), icon: Share2 },
          { id: 'site', label: t('tabs.site'), icon: Globe },
        ],
      },
      {
        label: t('organization.interface'),
        items: [
          { id: 'theme', label: t('organization.theme'), icon: Palette },
          { id: 'layouts', label: t('organization.layouts'), icon: LayoutGrid },
          { id: 'motion', label: t('organization.motion'), icon: Sparkles },
          { id: 'enhancements', label: t('organization.enhancements'), icon: WandSparkles },
        ],
      },
      {
        label: t('organization.services'),
        items: [
          { id: 'ai', label: t('organization.ai'), icon: Bot },
          { id: 'api', label: t('organization.api'), icon: Key },
          { id: 'connections', label: t('organization.connections'), icon: Cable },
        ],
      },
      {
        label: t('organization.extensions'),
        items: [
          { id: 'statistics', label: t('plugins:category.insights'), icon: BarChart3 },
          { id: 'plugins', label: t('organization.plugins'), icon: Puzzle },
        ],
      },
    ],
    [t]
  )

  if (isLoading || !localPreferences) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  const renderEnhancement = (id: string) => (
    <ExperimentalSettingsTab
      pluginId={id}
      tagHeatEnabled={true}
      tagHeatStyle={localPreferences.experimental_tag_heat_style}
      tagHeatEffect={localPreferences.experimental_tag_heat_effect}
      tagHeatColor={localPreferences.experimental_tag_heat_color}
      tagHeatIntensity={localPreferences.experimental_tag_heat_intensity}
      urlPrivacyEnabled={true}
      urlPrivacyEffect={localPreferences.experimental_url_privacy_effect}
      urlPrivacyStrength={localPreferences.experimental_url_privacy_strength}
      hoverCardEnabled={true}
      hoverCardTheme={localPreferences.experimental_hover_card_theme}
      hoverCardEffect={localPreferences.experimental_hover_card_effect}
      hoverCardAccentColor={localPreferences.experimental_hover_card_accent_color}
      hoverCardIntensity={localPreferences.experimental_hover_card_intensity}
      hoverCardSize={localPreferences.experimental_hover_card_size}
      hoverCardDelay={localPreferences.experimental_hover_card_delay}
      hoverCardAdvancedClicks={localPreferences.experimental_hover_card_advanced_clicks}
      hoverCardCollectorClicks={localPreferences.experimental_hover_card_collector_clicks}
      hoverCardSecretClicks={localPreferences.experimental_hover_card_secret_clicks}
      hoverCardShuffleEnabled={localPreferences.experimental_hover_card_shuffle_enabled}
      onTagHeatEnabledChange={(enabled) => handleUpdate({ experimental_tag_heat_enabled: enabled })}
      onTagHeatStyleChange={(style) => handleUpdate({ experimental_tag_heat_style: style })}
      onTagHeatEffectChange={(effect) => handleUpdate({ experimental_tag_heat_effect: effect })}
      onTagHeatColorChange={(color) => handleUpdate({ experimental_tag_heat_color: color })}
      onTagHeatIntensityChange={(intensity) =>
        handleUpdate({ experimental_tag_heat_intensity: intensity })
      }
      onUrlPrivacyEnabledChange={(enabled) =>
        handleUpdate({ experimental_url_privacy_enabled: enabled })
      }
      onUrlPrivacyEffectChange={(effect) =>
        handleUpdate({ experimental_url_privacy_effect: effect })
      }
      onUrlPrivacyStrengthChange={(strength) =>
        handleUpdate({ experimental_url_privacy_strength: strength })
      }
      onHoverCardEnabledChange={(enabled) =>
        handleUpdate({ experimental_hover_card_enabled: enabled })
      }
      onHoverCardThemeChange={(theme) => handleUpdate({ experimental_hover_card_theme: theme })}
      onHoverCardEffectChange={(effect) => handleUpdate({ experimental_hover_card_effect: effect })}
      onHoverCardAccentColorChange={(color) =>
        handleUpdate({ experimental_hover_card_accent_color: color })
      }
      onHoverCardIntensityChange={(intensity) =>
        handleUpdate({ experimental_hover_card_intensity: intensity })
      }
      onHoverCardSizeChange={(size) => handleUpdate({ experimental_hover_card_size: size })}
      onHoverCardDelayChange={(delay) => handleUpdate({ experimental_hover_card_delay: delay })}
      onHoverCardAdvancedClicksChange={(clicks) =>
        handleUpdate({ experimental_hover_card_advanced_clicks: clicks })
      }
      onHoverCardCollectorClicksChange={(clicks) =>
        handleUpdate({ experimental_hover_card_collector_clicks: clicks })
      }
      onHoverCardSecretClicksChange={(clicks) =>
        handleUpdate({ experimental_hover_card_secret_clicks: clicks })
      }
      onHoverCardShuffleEnabledChange={(enabled) =>
        handleUpdate({ experimental_hover_card_shuffle_enabled: enabled })
      }
    />
  )
  const inlineSettings = {
    'markvault.palettes': <PalettePluginSettings />,
    'markvault.theme-transition': <ThemeTransitionSettings />,
    'markvault.ocean': appearanceDraft && (
      <OceanBackgroundSettings value={appearanceDraft} onChange={handleUpdate} />
    ),
    'markvault.motion': <MotionPluginSettings />,
    'markvault.tag-heat': renderEnhancement('markvault.tag-heat'),
    'markvault.url-privacy': renderEnhancement('markvault.url-privacy'),
    'markvault.hover-card': renderEnhancement('markvault.hover-card'),
    'markvault.models': <ModelProviderPanel />,
    'markvault.mcp-client': <McpClientPanel />,
    'markvault.image-hosting': <ImageHostingPanel />,
    'markvault.browser-extension': <BrowserExtensionDownload />,
  }
  // 开着却不会生效、或会盖住其他效果的组合，在条目里直接说明
  const featureNotes = {
    'markvault.cursor':
      savedInterfaceTheme === 'vibehub' ? undefined : t('plugins:featureNote.cursor'),
    'markvault.ocean':
      savedInterfaceTheme === 'ascii' ? t('plugins:featureNote.oceanAscii') : undefined,
  }
  const featureList = (
    <RelatedPlugins
      key={activeSection}
      section={activeSection}
      settings={inlineSettings}
      notes={featureNotes}
      disabled={updatePreferences.isPending || isSavingTheme}
      onBusyChange={setIsUpdatingPlugin}
    />
  )

  return (
    <div
      data-management-theme={compact ? 'default' : undefined}
      className="markvault-settings-page w-full max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 space-y-4 sm:space-y-6"
    >
      {/* 页面标题 */}
      <div className="settings-page-heading card p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-foreground">{t('title')}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {user?.username && <span className="truncate">{user.username}</span>}
              {/* 版本号来自构建时注入的 package.json version */}
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {t('version.label', { version: __APP_VERSION__ })}
              </span>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="btn btn-ghost btn-sm flex items-center gap-2 text-error hover:bg-error/10 flex-shrink-0"
            title={t('action.logout')}
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">{t('action.logout')}</span>
          </button>
        </div>
      </div>

      {/* 侧栏导航 + 内容 */}
      <div className="settings-page-shell card p-3 sm:p-6">
        <SettingsNav
          groups={navGroups}
          activeSection={activeSection}
          onSectionChange={handleSectionChange}
        >
          <div className="settings-category-heading">
            <h2>
              {
                navGroups.flatMap((group) => group.items).find((item) => item.id === activeSection)
                  ?.label
              }
            </h2>
            <p>{t('organization.hints.' + activeSection)}</p>
          </div>
          {['layouts', 'motion', 'enhancements', 'ai', 'api', 'connections', 'statistics'].includes(
            activeSection
          ) && featureList}
          {activeSection === 'plugins' && <CustomPluginsSection />}
          {activeSection === 'basic' && <BasicSettingsTab />}

          {activeSection === 'theme' && (
            <div className="space-y-6">
              <ThemeSettingsTab
                interfaceTheme={interfaceTheme}
                onInterfaceThemeChange={handleInterfaceThemeChange}
              />
              {/* 界面主题由上面的选择器切换，ASCII 终端的选项在它生效时出现在这里 */}
              {!safe && asciiPlugin && isPluginRunning(asciiPlugin) && (
                <SettingsSection icon={Terminal} title={t('plugins:asciiOptions')}>
                  <PluginSettingsForm plugin={asciiPlugin} />
                </SettingsSection>
              )}
              {/* 液态玻璃的选项和融合演示同样只在主题生效时出现 */}
              {!safe && glassPlugin && isPluginRunning(glassPlugin) && (
                <SettingsSection icon={Droplets} title={t('plugins:liquidGlass.options')}>
                  <LiquidGlassPlayground
                    fusion={resolveLiquidGlassConfig(glassPlugin.config).fusion}
                    animated={motion.active}
                  />
                  <PluginSettingsForm plugin={glassPlugin} />
                </SettingsSection>
              )}
              <CanvasModeSettings />
              <ShellPicker />
              {featureList}
              <TagDisplaySettings
                enabled={localPreferences.show_tag_icons ?? true}
                onEnabledChange={(enabled) => handleUpdate({ show_tag_icons: enabled })}
              />
            </div>
          )}

          {activeSection === 'automation' && (
            <AutomationSettingsTab
              bookmarkInitialCount={localPreferences.bookmark_initial_count ?? 30}
              bookmarkPageSize={localPreferences.page_size ?? 30}
              bookmarkExpiryMinutes={localPreferences.bookmark_load_more_expiry_minutes ?? 5}
              onBookmarkInitialCountChange={(count) =>
                handleUpdate({ bookmark_initial_count: count })
              }
              onBookmarkPageSizeChange={(count) => handleUpdate({ page_size: count })}
              onBookmarkExpiryMinutesChange={(minutes) =>
                handleUpdate({ bookmark_load_more_expiry_minutes: minutes })
              }
              searchEnabled={localPreferences.enable_search_auto_clear}
              searchSeconds={localPreferences.search_auto_clear_seconds}
              tagEnabled={localPreferences.enable_tag_selection_auto_clear}
              tagSeconds={localPreferences.tag_selection_auto_clear_seconds}
              onSearchEnabledChange={(enabled) =>
                handleUpdate({ enable_search_auto_clear: enabled })
              }
              onSearchSecondsChange={(seconds) =>
                handleUpdate({ search_auto_clear_seconds: seconds })
              }
              onTagEnabledChange={(enabled) =>
                handleUpdate({ enable_tag_selection_auto_clear: enabled })
              }
              onTagSecondsChange={(seconds) =>
                handleUpdate({ tag_selection_auto_clear_seconds: seconds })
              }
            />
          )}

          {activeSection === 'site' && <SiteSettingsTab />}
          {activeSection === 'api' && <ApiSettingsTab />}
          {activeSection === 'share' && <ShareSettingsTab />}
          {activeSection === 'data' && (
            <div className="space-y-6">
              <SnapshotSettingsTab
                retentionCount={localPreferences.snapshot_retention_count}
                onRetentionCountChange={(count) =>
                  handleUpdate({ snapshot_retention_count: count })
                }
              />
              <DataSettingsTab />
            </div>
          )}

          {/* 网站设置有自己的保存按钮与草稿，避免同时出现两个作用不明的保存栏 */}
          {activeSection !== 'site' && (
            <SettingsSaveBar
              compact={compact}
              isDirty={isDirty}
              isSaving={updatePreferences.isPending || isSavingTheme || isUpdatingPlugin}
              onSave={handleSave}
              onDiscard={handleDiscard}
            />
          )}
          <PluginSlot name="settings" />
        </SettingsNav>
      </div>
    </div>
  )
}
