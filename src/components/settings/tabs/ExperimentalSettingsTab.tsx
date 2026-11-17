import type { CSSProperties } from 'react'
import {
  Beaker,
  Clock3,
  CreditCard,
  Droplets,
  EyeOff,
  Gem,
  Shuffle,
  Sparkles,
  Tag,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SettingsDivider } from '../SettingsSection'
import { NumberSetting } from '../BookmarkLoadingSettings'
import { SettingsSwitchRow, SettingsSwitchSection } from '../SettingsSwitchRow'
import type {
  ExperimentalHoverCardEffect,
  ExperimentalHoverCardTheme,
  ExperimentalTagHeatEffect,
  ExperimentalTagHeatStyle,
  ExperimentalUrlPrivacyEffect,
} from '@/lib/types'
import { resolveHoverCardEffect } from '@/components/bookmarks/shared/BookmarkHoverCard'
import { getTagHeatRarity, resolveTagHeatEffect } from '@/components/tags/tagHeatEffects'

interface ExperimentalSettingsTabProps {
  pluginId?: string
  tagHeatEnabled: boolean
  tagHeatStyle: ExperimentalTagHeatStyle
  tagHeatEffect: ExperimentalTagHeatEffect
  tagHeatColor: string
  tagHeatIntensity: number
  urlPrivacyEnabled: boolean
  urlPrivacyEffect: ExperimentalUrlPrivacyEffect
  urlPrivacyStrength: number
  hoverCardEnabled: boolean
  hoverCardTheme: ExperimentalHoverCardTheme
  hoverCardEffect: ExperimentalHoverCardEffect
  hoverCardAccentColor: string
  hoverCardIntensity: number
  hoverCardSize: number
  hoverCardDelay: number
  hoverCardAdvancedClicks: number
  hoverCardCollectorClicks: number
  hoverCardSecretClicks: number
  hoverCardShuffleEnabled: boolean
  onTagHeatEnabledChange: (enabled: boolean) => void
  onTagHeatStyleChange: (style: ExperimentalTagHeatStyle) => void
  onTagHeatEffectChange: (effect: ExperimentalTagHeatEffect) => void
  onTagHeatColorChange: (color: string) => void
  onTagHeatIntensityChange: (intensity: number) => void
  onUrlPrivacyEnabledChange: (enabled: boolean) => void
  onUrlPrivacyEffectChange: (effect: ExperimentalUrlPrivacyEffect) => void
  onUrlPrivacyStrengthChange: (strength: number) => void
  onHoverCardEnabledChange: (enabled: boolean) => void
  onHoverCardThemeChange: (theme: ExperimentalHoverCardTheme) => void
  onHoverCardEffectChange: (effect: ExperimentalHoverCardEffect) => void
  onHoverCardAccentColorChange: (color: string) => void
  onHoverCardIntensityChange: (intensity: number) => void
  onHoverCardSizeChange: (size: number) => void
  onHoverCardDelayChange: (delay: number) => void
  onHoverCardAdvancedClicksChange: (clicks: number) => void
  onHoverCardCollectorClicksChange: (clicks: number) => void
  onHoverCardSecretClicksChange: (clicks: number) => void
  onHoverCardShuffleEnabledChange: (enabled: boolean) => void
}

interface TagHeatPreviewProps {
  style: ExperimentalTagHeatStyle
  effect: ExperimentalTagHeatEffect
  color: string
  intensity: number
}

type TagHeatPreviewStyle = CSSProperties & {
  '--tag-heat-color': string
  '--tag-heat-strength': number
}

function TagHeatPreview({ style, effect, color, intensity }: TagHeatPreviewProps) {
  const { t } = useTranslation('settings')
  const levels = [0.14, 0.36, 0.66, 1]

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {levels.map((level, index) => {
        const opacity = (0.12 + level * 0.58) * (intensity / 100)
        const rarity = getTagHeatRarity(level)
        const resolvedEffect = resolveTagHeatEffect(effect, rarity)
        return (
          <div
            key={level}
            className="relative overflow-hidden rounded-lg border border-border bg-card px-3 py-2 text-center text-xs font-medium"
          >
            {style === 'fill' && (
              <div className="absolute inset-0" style={{ backgroundColor: color, opacity }} />
            )}
            {style === 'progress' && (
              <div className="absolute inset-x-0 bottom-0 h-1.5 bg-muted/30">
                <div
                  className="h-full"
                  style={{
                    width: `${level * 100}%`,
                    backgroundColor: color,
                    opacity: opacity + 0.2,
                  }}
                />
              </div>
            )}
            {style === 'liquid' && (
              <div
                className="tag-liquid-fill absolute inset-x-0 bottom-0"
                style={{
                  height: `${Math.max(8, level * 100)}%`,
                  backgroundColor: color,
                  opacity: opacity + 0.12,
                }}
              />
            )}
            {style === 'rarity' && (
              <div
                className={`tag-heat-card tag-heat-card--${rarity} tag-heat-card--effect-${resolvedEffect} absolute inset-0`}
                style={
                  {
                    '--tag-heat-color': color,
                    '--tag-heat-strength': Math.max(0.2, level * (intensity / 100)),
                  } as TagHeatPreviewStyle
                }
              >
                <div className="tag-heat-card__effect" />
                <div className="tag-heat-card__sparkles" />
              </div>
            )}
            <span className="relative z-10 block">{[8, 32, 72, 126][index]}</span>
            {style === 'rarity' && (
              <span className="relative z-10 mt-0.5 block text-[9px] text-muted-foreground">
                {t(`experimental.tagHeat.rarities.${rarity}`)}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

interface UrlPrivacyPreviewProps {
  effect: ExperimentalUrlPrivacyEffect
  strength: number
}

type PreviewStyle = CSSProperties & {
  '--url-privacy-blur'?: string
  '--url-privacy-block-size'?: string
}

function UrlPrivacyPreview({ effect, strength }: UrlPrivacyPreviewProps) {
  const value = 'https://private.example.com/account'

  if (effect === 'mask') {
    return <span className="url-privacy-mask">██████████████████</span>
  }

  return (
    <span
      className={effect === 'blur' ? 'url-privacy-blur' : 'url-privacy-mosaic'}
      style={
        (effect === 'blur'
          ? { '--url-privacy-blur': `${1 + strength * 0.55}px` }
          : { '--url-privacy-block-size': `${3 + strength}px` }) as PreviewStyle
      }
    >
      {value}
    </span>
  )
}

interface HoverCardPreviewProps {
  theme: ExperimentalHoverCardTheme
  effect: ExperimentalHoverCardEffect
  accentColor: string
  intensity: number
  size: number
}

type HoverCardPreviewStyle = CSSProperties & {
  '--tcg-accent': string
  '--tcg-intensity': number
  '--tcg-pointer-x': string
  '--tcg-pointer-y': string
  '--tcg-rotate-x': string
  '--tcg-rotate-y': string
}

function HoverCardPreview({ theme, effect, accentColor, intensity, size }: HoverCardPreviewProps) {
  const { t } = useTranslation('settings')
  const resolvedEffect = resolveHoverCardEffect(effect, 'secret')
  const style: HoverCardPreviewStyle = {
    '--tcg-accent': accentColor,
    '--tcg-intensity': intensity / 100,
    '--tcg-pointer-x': '58%',
    '--tcg-pointer-y': '35%',
    '--tcg-rotate-x': '-1.5deg',
    '--tcg-rotate-y': '2.5deg',
  }

  return (
    <div
      className="mx-auto w-full py-2 transition-[max-width] duration-200"
      style={{ maxWidth: `${2.8 * size}px` }}
    >
      <div
        className={`bookmark-tcg-card bookmark-tcg-card--${theme} bookmark-tcg-card--secret bookmark-tcg-card--effect-${resolvedEffect}`}
        style={style}
      >
        <div className="bookmark-tcg-card__effect" />
        <div className="bookmark-tcg-card__sparkles" />
        <div className="bookmark-tcg-card__frame">
          <header className="bookmark-tcg-card__header">
            <div className="min-w-0">
              <div className="bookmark-tcg-card__series">MV · PREVIEW</div>
              <h2>{t('experimental.hoverCard.previewTitle')}</h2>
            </div>
            <div className="bookmark-tcg-card__rarity bookmark-tcg-card__rarity--secret">
              <Sparkles className="h-3.5 w-3.5" />
              {t('experimental.hoverCard.rarities.secret')}
            </div>
          </header>
          <div className="bookmark-tcg-card__artwork flex items-center justify-center">
            <Gem className="h-20 w-20" style={{ color: accentColor }} />
            <div className="bookmark-tcg-card__domain">markvault.local / collection</div>
          </div>
          <div className="bookmark-tcg-card__stats">
            <div>
              <Sparkles />
              <strong>128</strong>
              <span>{t('experimental.hoverCard.card.visits')}</span>
            </div>
            <div>
              <Tag />
              <strong>6</strong>
              <span>{t('experimental.hoverCard.card.tags')}</span>
            </div>
            <div>
              <CreditCard />
              <strong>4</strong>
              <span>{t('experimental.hoverCard.card.snapshots')}</span>
            </div>
          </div>
          <div className="bookmark-tcg-card__details">
            <div className="bookmark-tcg-card__description">
              {t('experimental.hoverCard.previewDescription')}
            </div>
            <div className="bookmark-tcg-card__tags">
              <span style={{ '--tag-color': '#20a39e' } as CSSProperties}>Design</span>
              <span style={{ '--tag-color': '#ef476f' } as CSSProperties}>Collection</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ExperimentalSettingsTab({
  pluginId,
  tagHeatEnabled,
  tagHeatStyle,
  tagHeatEffect,
  tagHeatColor,
  tagHeatIntensity,
  urlPrivacyEnabled,
  urlPrivacyEffect,
  urlPrivacyStrength,
  hoverCardEnabled,
  hoverCardTheme,
  hoverCardEffect,
  hoverCardAccentColor,
  hoverCardIntensity,
  hoverCardSize,
  hoverCardDelay,
  hoverCardAdvancedClicks,
  hoverCardCollectorClicks,
  hoverCardSecretClicks,
  hoverCardShuffleEnabled,
  onTagHeatEnabledChange,
  onTagHeatStyleChange,
  onTagHeatEffectChange,
  onTagHeatColorChange,
  onTagHeatIntensityChange,
  onUrlPrivacyEnabledChange,
  onUrlPrivacyEffectChange,
  onUrlPrivacyStrengthChange,
  onHoverCardEnabledChange,
  onHoverCardThemeChange,
  onHoverCardEffectChange,
  onHoverCardAccentColorChange,
  onHoverCardIntensityChange,
  onHoverCardSizeChange,
  onHoverCardDelayChange,
  onHoverCardAdvancedClicksChange,
  onHoverCardCollectorClicksChange,
  onHoverCardSecretClicksChange,
  onHoverCardShuffleEnabledChange,
}: ExperimentalSettingsTabProps) {
  const { t } = useTranslation('settings')

  return (
    <div className="settings-switch-list space-y-6">
      {(!pluginId || pluginId === 'markvault.tag-heat') && (
        <SettingsSwitchSection
          icon={Tag}
          title={t('experimental.tagHeat.title')}
          description={t('experimental.tagHeat.description')}
          enableLabel={t('experimental.tagHeat.enable')}
          checked={tagHeatEnabled}
          onChange={onTagHeatEnabledChange}
          framed
          optionsOnly={Boolean(pluginId)}
        >
          {tagHeatEnabled && (
            <div className="space-y-5 border-t border-border pt-4">
              <label className="block space-y-2">
                <span className="text-sm font-medium">{t('experimental.tagHeat.style')}</span>
                <select
                  value={tagHeatStyle}
                  onChange={(event) =>
                    onTagHeatStyleChange(event.target.value as ExperimentalTagHeatStyle)
                  }
                  className="input w-full"
                >
                  <option value="fill">{t('experimental.tagHeat.styles.fill')}</option>
                  <option value="progress">{t('experimental.tagHeat.styles.progress')}</option>
                  <option value="liquid">{t('experimental.tagHeat.styles.liquid')}</option>
                  <option value="rarity">{t('experimental.tagHeat.styles.rarity')}</option>
                </select>
              </label>

              {tagHeatStyle === 'rarity' && (
                <label className="block space-y-2">
                  <span className="text-sm font-medium">{t('experimental.tagHeat.effect')}</span>
                  <select
                    value={tagHeatEffect}
                    onChange={(event) =>
                      onTagHeatEffectChange(event.target.value as ExperimentalTagHeatEffect)
                    }
                    className="input w-full"
                  >
                    <option value="auto">{t('experimental.tagHeat.effects.auto')}</option>
                    <option value="foil">{t('experimental.tagHeat.effects.foil')}</option>
                    <option value="diamond">{t('experimental.tagHeat.effects.diamond')}</option>
                    <option value="sparkle">{t('experimental.tagHeat.effects.sparkle')}</option>
                    <option value="prism">{t('experimental.tagHeat.effects.prism')}</option>
                    <option value="galaxy">{t('experimental.tagHeat.effects.galaxy')}</option>
                    <option value="none">{t('experimental.tagHeat.effects.none')}</option>
                  </select>
                  <p className="text-xs text-muted-foreground">
                    {t('experimental.tagHeat.effectHint')}
                  </p>
                </label>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium">{t('experimental.tagHeat.color')}</span>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={tagHeatColor}
                      onChange={(event) => onTagHeatColorChange(event.target.value)}
                      className="h-10 w-14 cursor-pointer rounded border border-border bg-transparent p-1"
                    />
                    <code className="flex-1 rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-sm">
                      {tagHeatColor.toUpperCase()}
                    </code>
                  </div>
                </label>

                <label className="space-y-2">
                  <span className="flex justify-between text-sm font-medium">
                    <span>{t('experimental.tagHeat.intensity')}</span>
                    <span className="text-muted-foreground">{tagHeatIntensity}%</span>
                  </span>
                  <input
                    type="range"
                    min="20"
                    max="100"
                    step="5"
                    value={tagHeatIntensity}
                    onChange={(event) => onTagHeatIntensityChange(Number(event.target.value))}
                    className="w-full accent-primary"
                  />
                </label>
              </div>

              <div className="space-y-2 rounded-lg bg-muted/40 p-3">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Droplets className="h-4 w-4" />
                  {t('experimental.preview')}
                </div>
                <TagHeatPreview
                  style={tagHeatStyle}
                  effect={tagHeatEffect}
                  color={tagHeatColor}
                  intensity={tagHeatIntensity}
                />
              </div>
            </div>
          )}
        </SettingsSwitchSection>
      )}

      {!pluginId && <SettingsDivider />}

      {(!pluginId || pluginId === 'markvault.url-privacy') && (
        <SettingsSwitchSection
          icon={EyeOff}
          title={t('experimental.urlPrivacy.title')}
          description={t('experimental.urlPrivacy.description')}
          enableLabel={t('experimental.urlPrivacy.enable')}
          checked={urlPrivacyEnabled}
          onChange={onUrlPrivacyEnabledChange}
          framed
          optionsOnly={Boolean(pluginId)}
        >
          {urlPrivacyEnabled && (
            <div className="space-y-5 border-t border-border pt-4">
              <label className="block space-y-2">
                <span className="text-sm font-medium">{t('experimental.urlPrivacy.effect')}</span>
                <select
                  value={urlPrivacyEffect}
                  onChange={(event) =>
                    onUrlPrivacyEffectChange(event.target.value as ExperimentalUrlPrivacyEffect)
                  }
                  className="input w-full"
                >
                  <option value="blur">{t('experimental.urlPrivacy.effects.blur')}</option>
                  <option value="mosaic">{t('experimental.urlPrivacy.effects.mosaic')}</option>
                  <option value="mask">{t('experimental.urlPrivacy.effects.mask')}</option>
                </select>
              </label>

              <label className="block space-y-2">
                <span className="flex justify-between text-sm font-medium">
                  <span>{t('experimental.urlPrivacy.strength')}</span>
                  <span className="text-muted-foreground">{urlPrivacyStrength}/12</span>
                </span>
                <input
                  type="range"
                  min="1"
                  max="12"
                  value={urlPrivacyStrength}
                  onChange={(event) => onUrlPrivacyStrengthChange(Number(event.target.value))}
                  className="w-full accent-primary"
                />
              </label>

              <div className="space-y-2 rounded-lg bg-muted/40 p-3">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Beaker className="h-4 w-4" />
                  {t('experimental.preview')}
                </div>
                <div className="overflow-hidden rounded border border-border bg-card px-3 py-2 text-sm text-primary">
                  <UrlPrivacyPreview effect={urlPrivacyEffect} strength={urlPrivacyStrength} />
                </div>
              </div>
            </div>
          )}
        </SettingsSwitchSection>
      )}

      {!pluginId && <SettingsDivider />}

      {(!pluginId || pluginId === 'markvault.hover-card') && (
        <SettingsSwitchSection
          icon={CreditCard}
          title={t('experimental.hoverCard.title')}
          description={t('experimental.hoverCard.description')}
          enableLabel={t('experimental.hoverCard.enable')}
          checked={hoverCardEnabled}
          onChange={onHoverCardEnabledChange}
          framed
          optionsOnly={Boolean(pluginId)}
        >
          {hoverCardEnabled && (
            <div className="space-y-5 border-t border-border pt-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium">{t('experimental.hoverCard.theme')}</span>
                  <select
                    value={hoverCardTheme}
                    onChange={(event) =>
                      onHoverCardThemeChange(event.target.value as ExperimentalHoverCardTheme)
                    }
                    className="input w-full"
                  >
                    <option value="creature">{t('experimental.hoverCard.themes.creature')}</option>
                    <option value="duelist">{t('experimental.hoverCard.themes.duelist')}</option>
                    <option value="arcane">{t('experimental.hoverCard.themes.arcane')}</option>
                  </select>
                </label>

                <label className="space-y-2">
                  <span className="text-sm font-medium">{t('experimental.hoverCard.effect')}</span>
                  <select
                    value={hoverCardEffect}
                    onChange={(event) =>
                      onHoverCardEffectChange(event.target.value as ExperimentalHoverCardEffect)
                    }
                    className="input w-full"
                  >
                    <option value="auto">{t('experimental.hoverCard.effects.auto')}</option>
                    <option value="foil">{t('experimental.hoverCard.effects.foil')}</option>
                    <option value="prism">{t('experimental.hoverCard.effects.prism')}</option>
                    <option value="galaxy">{t('experimental.hoverCard.effects.galaxy')}</option>
                    <option value="none">{t('experimental.hoverCard.effects.none')}</option>
                  </select>
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium">
                    {t('experimental.hoverCard.accentColor')}
                  </span>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={hoverCardAccentColor}
                      onChange={(event) => onHoverCardAccentColorChange(event.target.value)}
                      className="h-10 w-14 cursor-pointer rounded border border-border bg-transparent p-1"
                    />
                    <code className="flex-1 rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-sm">
                      {hoverCardAccentColor.toUpperCase()}
                    </code>
                  </div>
                </label>

                <label className="space-y-2">
                  <span className="flex justify-between text-sm font-medium">
                    <span>{t('experimental.hoverCard.intensity')}</span>
                    <span className="text-muted-foreground">{hoverCardIntensity}%</span>
                  </span>
                  <input
                    type="range"
                    min="20"
                    max="100"
                    step="5"
                    value={hoverCardIntensity}
                    onChange={(event) => onHoverCardIntensityChange(Number(event.target.value))}
                    className="w-full accent-primary"
                  />
                </label>
              </div>

              <label className="block space-y-2">
                <span className="flex justify-between text-sm font-medium">
                  <span>{t('experimental.hoverCard.size')}</span>
                  <span className="text-muted-foreground">{hoverCardSize}%</span>
                </span>
                <input
                  type="range"
                  min="75"
                  max="125"
                  step="5"
                  value={hoverCardSize}
                  onChange={(event) => onHoverCardSizeChange(Number(event.target.value))}
                  className="w-full accent-primary"
                />
              </label>

              <label className="block space-y-2">
                <span className="flex justify-between text-sm font-medium">
                  <span className="flex items-center gap-2">
                    <Clock3 className="h-4 w-4" />
                    {t('experimental.hoverCard.delay')}
                  </span>
                  <span className="text-muted-foreground">{hoverCardDelay} ms</span>
                </span>
                <input
                  type="range"
                  min="100"
                  max="1500"
                  step="50"
                  value={hoverCardDelay}
                  onChange={(event) => onHoverCardDelayChange(Number(event.target.value))}
                  className="w-full accent-primary"
                />
              </label>

              <div className="space-y-3">
                <div>
                  <div className="text-sm font-medium">
                    {t('experimental.hoverCard.thresholds.title')}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('experimental.hoverCard.thresholds.hint')}
                  </p>
                </div>
                <div className="space-y-3">
                  <NumberSetting
                    id="hover-advanced-clicks"
                    label={t('experimental.hoverCard.rarities.advanced')}
                    value={hoverCardAdvancedClicks}
                    min={1}
                    max={hoverCardCollectorClicks - 1}
                    presets={[3, 5, 10]}
                    onChange={onHoverCardAdvancedClicksChange}
                  />
                  <NumberSetting
                    id="hover-collector-clicks"
                    label={t('experimental.hoverCard.rarities.collector')}
                    value={hoverCardCollectorClicks}
                    min={hoverCardAdvancedClicks + 1}
                    max={hoverCardSecretClicks - 1}
                    presets={[10, 20, 30]}
                    onChange={onHoverCardCollectorClicksChange}
                  />
                  <NumberSetting
                    id="hover-secret-clicks"
                    label={t('experimental.hoverCard.rarities.secret')}
                    value={hoverCardSecretClicks}
                    min={hoverCardCollectorClicks + 1}
                    max={100000}
                    presets={[50, 100, 200]}
                    onChange={onHoverCardSecretClicksChange}
                  />
                </div>
              </div>

              <SettingsSwitchRow
                title={t('experimental.hoverCard.shuffle.title')}
                description={t('experimental.hoverCard.shuffle.hint')}
                icon={Shuffle}
                checked={hoverCardShuffleEnabled}
                onChange={onHoverCardShuffleEnabledChange}
              />

              <div className="space-y-3 rounded-lg bg-muted/40 p-3">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Gem className="h-4 w-4" />
                  {t('experimental.preview')}
                </div>
                <div className="grid grid-cols-4 gap-1.5 text-center text-[10px] font-bold">
                  {(['base', 'advanced', 'collector', 'secret'] as const).map((rarity) => (
                    <span
                      key={rarity}
                      className={`bookmark-tcg-card__rarity bookmark-tcg-card__rarity--${rarity} justify-center`}
                    >
                      {t(`experimental.hoverCard.rarities.${rarity}`)}
                    </span>
                  ))}
                </div>
                <HoverCardPreview
                  theme={hoverCardTheme}
                  effect={hoverCardEffect}
                  accentColor={hoverCardAccentColor}
                  intensity={hoverCardIntensity}
                  size={hoverCardSize}
                />
              </div>
            </div>
          )}
        </SettingsSwitchSection>
      )}
    </div>
  )
}
