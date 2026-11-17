/** 公开分享使用紧凑表单；启停与内容统一保存。 */
import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Share2, Copy, RefreshCw } from 'lucide-react'
import { useShareSettings, useUpdateShareSettings } from '@/hooks/useShare'
import { useToastStore } from '@/stores/toastStore'
import { SettingsSwitchRow } from '../SettingsSwitchRow'
import { SettingsField } from '../SettingsField'

export function ShareSettingsTab() {
  const { t } = useTranslation('settings')
  const { data, isLoading, isError, refetch } = useShareSettings()
  const updateShare = useUpdateShareSettings()
  const { addToast } = useToastStore()
  const [enabled, setEnabled] = useState(false)
  const [slug, setSlug] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  useEffect(() => {
    if (!data) return
    setEnabled(data.enabled || false)
    setSlug(data.slug || '')
    setTitle(data.title || '')
    setDescription(data.description || '')
  }, [data])
  const dirty = Boolean(
    data &&
    (enabled !== data.enabled ||
      slug.trim() !== (data.slug || '') ||
      title.trim() !== (data.title || '') ||
      description.trim() !== (data.description || ''))
  )
  const shareUrl = useMemo(
    () => (data?.slug && data.enabled ? window.location.origin + '/share/' + data.slug : ''),
    [data]
  )
  const discard = () => {
    setEnabled(data?.enabled || false)
    setSlug(data?.slug || '')
    setTitle(data?.title || '')
    setDescription(data?.description || '')
  }
  const handleSave = async () => {
    try {
      await updateShare.mutateAsync({
        enabled,
        slug: slug.trim() || null,
        title: title.trim() || null,
        description: description.trim() || null,
      })
      addToast('success', t('share.saveSuccess'))
    } catch {
      addToast('error', t('share.saveFailed'))
    }
  }
  const handleRegenerate = async () => {
    try {
      await updateShare.mutateAsync({
        regenerate_slug: true,
        enabled: true,
        title: title.trim() || null,
        description: description.trim() || null,
      })
      addToast('success', t('share.regenerateSuccess'))
    } catch {
      addToast('error', t('share.regenerateFailed'))
    }
  }
  const handleCopyLink = async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      addToast('success', t('share.copySuccess'))
    } catch {
      addToast('error', t('share.copyFailed'))
    }
  }
  if (isLoading)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('data.loading')}
      </p>
    )
  if (isError || !data)
    return (
      <div role="alert">
        <p>{t('share.loadFailed')}</p>
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => void refetch()}>
          {t('form.retry')}
        </button>
      </div>
    )
  return (
    <div className="settings-share-form space-y-4">
      <fieldset disabled={updateShare.isPending} className="space-y-4 min-w-0">
        <SettingsSwitchRow
          icon={Share2}
          title={t('share.publicShare.enable')}
          description={t('share.publicShare.enableHint')}
          checked={enabled}
          onChange={setEnabled}
        />
        {enabled && (
          <div className="settings-form-list space-y-3">
            <SettingsField
              id="share-slug"
              label={t('share.slug.label')}
              hint={t('share.slug.hint')}
            >
              <div className="settings-control-line flex items-center gap-2">
                <input
                  id="share-slug"
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder={t('share.slug.placeholder')}
                  className="input min-w-0 flex-1"
                  aria-describedby="share-slug-hint"
                />
                <button
                  type="button"
                  onClick={handleRegenerate}
                  className="btn btn-sm btn-ghost"
                  title={t('share.slug.regenerate')}
                  aria-label={t('share.slug.regenerate')}
                >
                  <RefreshCw size={14} />
                </button>
              </div>
            </SettingsField>
            <SettingsField id="share-title" label={t('share.pageTitle.label')}>
              <input
                id="share-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('share.pageTitle.placeholder')}
                className="input w-full"
              />
            </SettingsField>
            <SettingsField id="share-description" label={t('share.pageDescription.label')}>
              <textarea
                id="share-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('share.pageDescription.placeholder')}
                rows={2}
                className="input w-full resize-y"
              />
            </SettingsField>
            <SettingsField
              id="share-url"
              label={t('share.shareLink.label')}
              hint={t('share.savedLinkHint')}
            >
              <div className="settings-control-line flex items-center gap-2">
                <input
                  id="share-url"
                  type="text"
                  readOnly
                  value={shareUrl}
                  placeholder={t('share.shareLink.placeholder')}
                  className="input min-w-0 flex-1"
                  aria-describedby="share-url-hint"
                />
                <button
                  type="button"
                  onClick={handleCopyLink}
                  disabled={!shareUrl}
                  className="btn btn-sm btn-secondary"
                >
                  <Copy size={14} />
                  {t('share.shareLink.copy')}
                </button>
              </div>
            </SettingsField>
          </div>
        )}
      </fieldset>
      <div className="settings-form-actions flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={updateShare.isPending || !dirty}
          className="btn btn-sm btn-primary"
        >
          {updateShare.isPending ? t('action.saving') : t('action.save')}
        </button>
        {dirty && (
          <button
            type="button"
            onClick={discard}
            disabled={updateShare.isPending}
            className="btn btn-sm btn-ghost"
          >
            {t('action.discard')}
          </button>
        )}
        <span className="text-xs text-muted-foreground">
          {dirty ? t('message.unsavedChanges') : t('share.savedHint')}
        </span>
      </div>
    </div>
  )
}
