/**
 * 网站设置标签页
 *
 * 站点品牌信息是全局单例数据，仅管理员可修改。
 * 该页维护自己的草稿与保存逻辑，不影响其他设置页的保存流程：
 * 未保存的编辑只作用于本地状态，不会外溢到全站。
 */

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  Globe,
  Image,
  Link2,
  RotateCcw,
  Save,
  ShieldAlert,
  Upload,
} from 'lucide-react'
import { useSiteSettings, useUpdateSiteSettings } from '@/hooks/useSiteBranding'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { ApiError } from '@/lib/api-client'
import {
  DEFAULT_SITE_NAME,
  MAX_SITE_DESCRIPTION_LENGTH,
  MAX_SITE_NAME_LENGTH,
  SITE_IMAGE_ACCEPT,
  countCharacters,
  isValidSiteDescription,
  isValidSiteImage,
  isValidSiteName,
  readSiteImageFile,
} from '@/lib/site-branding'
import { SettingsSection, SettingsDivider } from '../SettingsSection'
import { InfoBox } from '../InfoBox'
import { SiteBrandImage } from '@/components/common/SiteBrandImage'

type ImageField = 'site_logo' | 'site_favicon'
interface SiteDraft {
  site_name: string
  site_description: string
  site_logo: string
  site_favicon: string
}

function toDraft(site?: {
  site_name?: string
  site_description?: string
  site_logo?: string
  site_favicon?: string
}): SiteDraft {
  return {
    site_name: site?.site_name ?? '',
    site_description: site?.site_description ?? '',
    site_logo: site?.site_logo ?? '',
    site_favicon: site?.site_favicon ?? '',
  }
}

/** 比较两份草稿是否一致，用于判断用户是否真的修改过内容 */
function isSameDraft(a: SiteDraft, b: SiteDraft): boolean {
  return (
    a.site_name === b.site_name &&
    a.site_description === b.site_description &&
    a.site_logo === b.site_logo &&
    a.site_favicon === b.site_favicon
  )
}

export function SiteSettingsTab() {
  const { t } = useTranslation('settings')
  const { t: tCommon } = useTranslation('common')
  const { addToast } = useToastStore()
  const { user } = useAuthStore()
  const { data, isLoading, isError, refetch, isFetching } = useSiteSettings({
    enabled: Boolean(user),
    userId: user?.id,
  })
  const updateSite = useUpdateSiteSettings(user?.id)

  const [draft, setDraft] = useState<SiteDraft | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  // 草稿对应的服务端基线，用于区分“后台刷新”与“用户正在编辑”
  const baselineRef = useRef<SiteDraft | null>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const faviconInputRef = useRef<HTMLInputElement>(null)

  const canEdit = data?.can_edit ?? false
  const saved = useMemo(() => (data?.site ? toDraft(data.site) : null), [data?.site])

  useEffect(() => {
    if (!saved) return
    const baseline = baselineRef.current
    setDraft((current) => {
      // 首次加载，或用户没有未保存修改：跟随最新服务端值
      if (!current || !baseline || isSameDraft(current, baseline)) return saved
      // 用户正在编辑：保留草稿，避免后台刷新抹掉输入
      return current
    })
    baselineRef.current = saved
  }, [saved])

  const current = draft ?? saved
  const isDirty = Boolean(current && saved && !isSameDraft(current, saved))

  // 首次加载与读取失败要区分：失败时显示错误与重试，不会停在加载动画
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (isError || !current) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-error/30 bg-error/10 px-4 py-10 text-center">
        <AlertCircle className="h-6 w-6 text-error" aria-hidden="true" />
        <p className="text-sm text-error">{t('site.loadFailed')}</p>
        <button
          type="button"
          onClick={() => {
            void refetch()
          }}
          disabled={isFetching}
          className="btn btn-ghost btn-sm min-h-11 flex items-center gap-1.5"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {isFetching ? t('site.loading') : t('site.retry')}
        </button>
      </div>
    )
  }

  const patch = (updates: Partial<SiteDraft>) => {
    setDraft((prev) => ({ ...(prev ?? current), ...updates }))
    setNotice('')
    setError('')
  }

  const handleUpload = async (field: ImageField, file?: File) => {
    if (!file) return
    try {
      const dataUri = await readSiteImageFile(file)
      patch({ [field]: dataUri } as Partial<SiteDraft>)
    } catch {
      // 上传失败时保留原草稿，只提示错误
      addToast('error', t('site.message.invalidUpload'))
    }
  }

  const validate = (): string => {
    if (!isValidSiteName(current.site_name)) return t('site.message.invalidName')
    if (!isValidSiteDescription(current.site_description))
      return t('site.message.invalidDescription')
    if (!isValidSiteImage(current.site_logo)) return t('site.message.invalidLogo')
    if (!isValidSiteImage(current.site_favicon)) return t('site.message.invalidFavicon')
    return ''
  }

  const handleSave = async () => {
    const message = validate()
    if (message) {
      setError(message)
      return
    }
    try {
      const result = await updateSite.mutateAsync({
        site_name: current.site_name.trim(),
        site_description: current.site_description.trim(),
        site_logo: current.site_logo.trim(),
        site_favicon: current.site_favicon.trim(),
      })
      // 显式用服务端规范化后的值回填草稿，避免显示未 trim 的旧文本
      const normalized = toDraft(result.site)
      setDraft(normalized)
      baselineRef.current = normalized
      setNotice('')
      setError('')
      addToast('success', t('site.message.saveSuccess'))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('site.message.saveFailed'))
    }
  }

  // 恢复默认只填入草稿，保存后才应用到全站
  const handleRestoreDefaults = () => {
    if (!data?.defaults) return
    setDraft(toDraft(data.defaults))
    setNotice(t('site.message.defaultsNotice'))
    setError('')
  }

  const handleDiscard = () => {
    if (!saved) return
    setDraft(saved)
    baselineRef.current = saved
    setNotice('')
    setError('')
  }

  const previewName = current.site_name.trim() || DEFAULT_SITE_NAME
  // 与 SiteBrandingContext 保持一致：未设置描述时回落到默认描述
  const defaultDescription = tCommon('brand.defaultDescription')
  const rawDescription = current.site_description.trim()
  const previewDescription = rawDescription || defaultDescription
  const previewTitle = `${previewName} - ${previewDescription}`
  const disabled = !canEdit || updateSite.isPending

  return (
    <div className="space-y-6">
      {!canEdit && (
        <InfoBox icon={ShieldAlert} title={t('site.readOnly.title')} variant="warning">
          <p>{t('site.readOnly.description')}</p>
        </InfoBox>
      )}

      <SettingsSection icon={Globe} title={t('site.title')} description={t('site.subtitle')}>
        <div className="space-y-4">
          <div className="settings-inline-field space-y-2">
            <label className="text-sm font-medium" htmlFor="site-name">
              {t('site.name.label')}
            </label>
            <input
              id="site-name"
              type="text"
              className="input w-full"
              value={current.site_name}
              maxLength={MAX_SITE_NAME_LENGTH}
              disabled={disabled}
              placeholder={t('site.name.placeholder')}
              onChange={(event) => patch({ site_name: event.target.value })}
            />
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>{t('site.name.hint')}</span>
              <span>
                {countCharacters(current.site_name)}/{MAX_SITE_NAME_LENGTH}
              </span>
            </div>
          </div>

          <div className="settings-inline-field space-y-2">
            <label className="text-sm font-medium" htmlFor="site-description">
              {t('site.descriptionField.label')}
            </label>
            <textarea
              id="site-description"
              className="input min-h-[80px] w-full"
              value={current.site_description}
              maxLength={MAX_SITE_DESCRIPTION_LENGTH}
              disabled={disabled}
              placeholder={t('site.descriptionField.placeholder')}
              onChange={(event) => patch({ site_description: event.target.value })}
            />
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>{t('site.descriptionField.hint')}</span>
              <span>
                {countCharacters(current.site_description)}/{MAX_SITE_DESCRIPTION_LENGTH}
              </span>
            </div>
          </div>
        </div>
      </SettingsSection>

      <SettingsDivider />

      <SettingsSection
        icon={Image}
        title={t('site.images.title')}
        description={t('site.images.hint')}
      >
        <div className="settings-form-list grid gap-4 sm:grid-cols-2">
          <ImageFieldEditor
            id="site-logo"
            label={t('site.logo.label')}
            urlPlaceholder={t('site.logo.placeholder')}
            value={current.site_logo}
            disabled={disabled}
            inputRef={logoInputRef}
            onChange={(value) => patch({ site_logo: value })}
            onPickFile={(file) => handleUpload('site_logo', file)}
            round={false}
          />
          <ImageFieldEditor
            id="site-favicon"
            label={t('site.favicon.label')}
            urlPlaceholder={t('site.favicon.placeholder')}
            value={current.site_favicon}
            disabled={disabled}
            inputRef={faviconInputRef}
            onChange={(value) => patch({ site_favicon: value })}
            onPickFile={(file) => handleUpload('site_favicon', file)}
            round
          />
        </div>
      </SettingsSection>

      <SettingsDivider />

      {/* 实时预览：只反映当前草稿，保存前不影响全站 */}
      <SettingsSection
        icon={Link2}
        title={t('site.preview.title')}
        description={t('site.preview.hint')}
      >
        <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
          <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/80 px-3 py-2 shadow-sm">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-gradient-to-br from-primary to-secondary">
              <SiteBrandImage
                src={current.site_logo}
                alt={previewName}
                className="h-full w-full object-contain"
                fallback={<Globe className="h-4 w-4" aria-hidden="true" />}
              />
            </div>
            <div className="min-w-0">
              <div className="truncate text-base font-bold text-primary">{previewName}</div>
              <div className="truncate text-xs text-muted-foreground">{previewDescription}</div>
            </div>
          </div>
          <dl className="space-y-1 text-xs text-muted-foreground">
            <div className="flex flex-wrap gap-1">
              <dt className="font-medium">{t('site.preview.browserTitle')}</dt>
              <dd className="break-all">{previewTitle}</dd>
            </div>
            <div className="flex flex-wrap gap-1">
              <dt className="font-medium">{t('site.preview.metaDescription')}</dt>
              <dd className="break-all">{previewDescription}</dd>
            </div>
          </dl>
        </div>
      </SettingsSection>

      {error && (
        <div className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-muted-foreground">
          {notice || (isDirty ? t('message.unsavedChanges') : t('site.savedHint'))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleDiscard}
            disabled={disabled || !isDirty}
            className="btn btn-ghost btn-sm min-h-11 flex items-center gap-1.5"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t('action.discard')}
          </button>
          <button
            type="button"
            onClick={handleRestoreDefaults}
            disabled={disabled}
            className="btn btn-ghost btn-sm min-h-11 flex items-center gap-1.5"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t('site.action.restoreDefaults')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={disabled || !isDirty}
            className="btn btn-primary btn-sm min-h-11 flex items-center gap-1.5"
          >
            <Save className="h-3.5 w-3.5" />
            {updateSite.isPending ? t('action.saving') : t('site.action.saveSite')}
          </button>
        </div>
      </div>
    </div>
  )
}

function ImageFieldEditor({
  id,
  label,
  urlPlaceholder,
  value,
  disabled,
  inputRef,
  onChange,
  onPickFile,
  round,
}: {
  id: string
  label: string
  urlPlaceholder: string
  value: string
  disabled: boolean
  inputRef: RefObject<HTMLInputElement>
  onChange: (value: string) => void
  onPickFile: (file?: File) => void
  round: boolean
}) {
  const { t } = useTranslation('settings')

  return (
    <div className="settings-inline-field space-y-2">
      <label className="text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      <div className="flex items-start gap-3">
        <div
          className={
            'flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden border border-border bg-muted/30 ' +
            (round ? 'rounded-full' : 'rounded-xl')
          }
        >
          {/* 缩略图与页头共用同一组件，地址失效时回退到占位图标 */}
          <SiteBrandImage
            src={value}
            alt={label}
            className="h-full w-full object-contain"
            fallback={<Image className="h-5 w-5 text-muted-foreground" aria-hidden="true" />}
          />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <input
            id={id}
            type="url"
            className="input w-full"
            value={value.startsWith('data:') ? '' : value}
            disabled={disabled}
            placeholder={urlPlaceholder}
            onChange={(event) => onChange(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <input
              ref={inputRef}
              type="file"
              accept={SITE_IMAGE_ACCEPT}
              className="hidden"
              disabled={disabled}
              onChange={(event) => {
                onPickFile(event.target.files?.[0])
                // 允许重复选择同一文件
                event.target.value = ''
              }}
            />
            <button
              type="button"
              className="btn btn-ghost btn-sm min-h-9 flex items-center gap-1.5"
              disabled={disabled}
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" />
              {t('site.images.upload')}
            </button>
            {value.trim() && (
              <button
                type="button"
                className="btn btn-ghost btn-sm min-h-9"
                disabled={disabled}
                onClick={() => onChange('')}
              >
                {t('site.images.clear')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
