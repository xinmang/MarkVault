import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  BRAND_TAG_ICONS,
  GENERIC_TAG_ICONS,
  isValidTagIcon,
  MAX_TAG_ICON_BYTES,
} from '@/lib/tag-icons'
import { TagIcon } from './TagIcon'

type IconMode = 'auto' | 'brand' | 'icon' | 'image' | 'none'
function iconMode(value: string | null): IconMode {
  if (!value) return 'auto'
  if (value === 'none') return 'none'
  if (value.startsWith('brand:')) return 'brand'
  if (value.startsWith('icon:')) return 'icon'
  return 'image'
}

interface TagIconPickerProps {
  name: string
  value: string | null
  onChange: (icon: string | null) => void
  disabled?: boolean
}

export function TagIconPicker({ name, value, onChange, disabled }: TagIconPickerProps) {
  const { t } = useTranslation('tags')
  const [mode, setMode] = useState<IconMode>(() => iconMode(value))
  const [search, setSearch] = useState('')
  const [image, setImage] = useState(mode === 'image' ? (value ?? '') : '')
  const [error, setError] = useState('')
  const valid = isValidTagIcon(value)
  const selectMode = (next: IconMode) => {
    setMode(next)
    setError('')
    onChange(
      next === 'auto'
        ? null
        : next === 'none'
          ? 'none'
          : next === 'brand'
            ? 'brand:github'
            : next === 'icon'
              ? 'icon:tag'
              : image
    )
  }
  const upload = (file?: File) => {
    if (!file) return
    if (
      file.size > MAX_TAG_ICON_BYTES ||
      !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)
    ) {
      setError(t('icon.uploadError'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result)
      setImage(result)
      onChange(result)
      setError('')
    }
    reader.onerror = () => setError(t('icon.uploadError'))
    reader.readAsDataURL(file)
  }

  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <legend className="mb-2 text-sm font-medium">{t('icon.title')}</legend>
      <div className="flex items-center gap-3">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40"
          aria-hidden="true"
        >
          <TagIcon name={name} icon={value} className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <label htmlFor="tag-icon-mode" className="sr-only">
            {t('icon.source')}
          </label>
          <select
            id="tag-icon-mode"
            className="input min-h-11 w-full"
            value={mode}
            onChange={(e) => selectMode(e.target.value as IconMode)}
          >
            {(['auto', 'brand', 'icon', 'image', 'none'] as const).map((item) => (
              <option key={item} value={item}>
                {t('icon.modes.' + item)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {mode === 'auto' && <p className="text-xs text-muted-foreground">{t('icon.autoHint')}</p>}
      {mode === 'brand' && (
        <div className="space-y-2">
          <label htmlFor="tag-icon-search" className="sr-only">
            {t('icon.search')}
          </label>
          <input
            id="tag-icon-search"
            className="input w-full"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('icon.search')}
          />
          <div
            className="grid max-h-48 grid-cols-5 gap-1.5 overflow-y-auto p-1 sm:grid-cols-6"
            role="group"
            aria-label={t('icon.modes.brand')}
          >
            {BRAND_TAG_ICONS.filter((item) =>
              (item.title + item.id).toLowerCase().includes(search.toLowerCase().trim())
            ).map((item) => (
              <button
                type="button"
                key={item.id}
                title={item.title}
                aria-label={item.title}
                aria-pressed={value === 'brand:' + item.id}
                className={
                  'flex min-h-11 items-center justify-center rounded-lg border p-2 transition-colors focus-visible:outline-2 focus-visible:outline-primary ' +
                  (value === 'brand:' + item.id
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:bg-muted')
                }
                onClick={() => onChange('brand:' + item.id)}
              >
                <TagIcon name="" icon={'brand:' + item.id} className="h-5 w-5" />
              </button>
            ))}
          </div>
          {!BRAND_TAG_ICONS.some((item) =>
            (item.title + item.id).toLowerCase().includes(search.toLowerCase().trim())
          ) && <p className="text-xs text-muted-foreground">{t('icon.noMatch')}</p>}
        </div>
      )}
      {mode === 'icon' && (
        <div
          className="grid grid-cols-5 gap-1.5 p-1 sm:grid-cols-6"
          role="group"
          aria-label={t('icon.modes.icon')}
        >
          {GENERIC_TAG_ICONS.map(({ id, component: Icon }) => (
            <button
              type="button"
              key={id}
              title={t('icon.names.' + id)}
              aria-label={t('icon.names.' + id)}
              aria-pressed={value === 'icon:' + id}
              className={
                'flex min-h-11 items-center justify-center rounded-lg border p-2 transition-colors focus-visible:outline-2 focus-visible:outline-primary ' +
                (value === 'icon:' + id
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border hover:bg-muted')
              }
              onClick={() => onChange('icon:' + id)}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
      {mode === 'image' && (
        <div className="space-y-2">
          <label htmlFor="tag-icon-url" className="text-xs text-muted-foreground">
            {t('icon.url')}
          </label>
          <input
            id="tag-icon-url"
            type="url"
            className="input w-full"
            placeholder="https://example.com/logo.png"
            value={image.startsWith('data:') ? '' : image}
            aria-invalid={!valid}
            aria-describedby="tag-icon-image-hint"
            onChange={(e) => {
              setImage(e.target.value)
              onChange(e.target.value.trim())
              setError('')
            }}
          />
          <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-dashed border-border px-3 text-sm hover:bg-muted focus-within:ring-2 focus-within:ring-primary">
            {t('icon.upload')}
            <input
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="sr-only"
              onChange={(e) => {
                upload(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </label>
          <p id="tag-icon-image-hint" className="text-xs text-muted-foreground">
            {image.startsWith('data:') ? t('icon.uploaded') : t('icon.imageHint')}
          </p>
          {!valid && <p className="text-xs text-error">{t('icon.invalid')}</p>}
        </div>
      )}
      {error && (
        <p className="text-xs text-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  )
}
