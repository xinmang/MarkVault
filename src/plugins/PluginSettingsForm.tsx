import { useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PluginState } from '@shared/plugin-types'
import { Toggle } from '@/components/common/Toggle'
import { pluginAPI } from './api'
import { usePlugins } from './context'
import { localizedText, pluginShortId } from './localize'
import '@/styles/plugin-settings.css'

type Config = Record<string, unknown>

/** 分段单选最多容纳的选项数，超过后改用下拉框。 */
const SEGMENTED_LIMIT = 4
/** 保存成功提示的停留时间；详情页保存后会按新修订号重新挂载，提示需要跨挂载保留。 */
const NOTICE_MS = 4000
const savedAt = new Map<string, number>()

export interface PluginSettingsField {
  name: string
  kind: 'boolean' | 'segmented' | 'select' | 'range' | 'number' | 'text' | 'multi' | 'json'
  /** Schema 里的原始文本，可能是「中文 / English」，显示前按界面语言取一半 */
  title: string
  description?: string
  required: boolean
  default?: unknown
  options?: string[]
  integer?: boolean
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  maxItems?: number
}

function isRecord(value: unknown): value is Config {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
const finite = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string')

/** 把设置 Schema 的顶层属性推导成表单字段；无法用控件表达的结构退回 JSON 文本框。 */
// eslint-disable-next-line react-refresh/only-export-components
export function schemaFields(schema: unknown): PluginSettingsField[] {
  if (!isRecord(schema) || schema.type !== 'object' || !isRecord(schema.properties)) return []
  const required = Array.isArray(schema.required) ? schema.required : []
  return Object.entries(schema.properties).map(([name, raw]) => {
    const property = isRecord(raw) ? raw : {}
    const field: PluginSettingsField = {
      name,
      kind: 'json',
      title: typeof property.title === 'string' && property.title ? property.title : name,
      description:
        typeof property.description === 'string' && property.description
          ? property.description
          : undefined,
      required: required.includes(name),
      default: property.default,
    }
    const minimum = finite(property.minimum)
    const maximum = finite(property.maximum)
    if (property.type === 'boolean') return { ...field, kind: 'boolean' }
    if (property.type === 'string') {
      if (property.enum === undefined)
        return {
          ...field,
          kind: 'text',
          minLength: finite(property.minLength),
          maxLength: finite(property.maxLength),
        }
      if (strings(property.enum))
        return {
          ...field,
          kind: property.enum.length <= SEGMENTED_LIMIT ? 'segmented' : 'select',
          options: property.enum,
        }
      return field
    }
    if ((property.type === 'integer' || property.type === 'number') && property.enum === undefined)
      return {
        ...field,
        kind:
          minimum !== undefined && maximum !== undefined && maximum > minimum ? 'range' : 'number',
        integer: property.type === 'integer',
        minimum,
        maximum,
      }
    if (
      property.type === 'array' &&
      isRecord(property.items) &&
      property.items.type === 'string' &&
      strings(property.items.enum)
    )
      return {
        ...field,
        kind: 'multi',
        options: property.items.enum,
        maxItems: finite(property.maxItems),
      }
    return field
  })
}

/** 值与字段不匹配时返回 undefined，由调用方改用默认值。 */
function accept(field: PluginSettingsField, value: unknown): unknown {
  switch (field.kind) {
    case 'boolean':
      return typeof value === 'boolean' ? value : undefined
    case 'segmented':
    case 'select':
      return typeof value === 'string' && field.options?.includes(value) ? value : undefined
    case 'range':
    case 'number': {
      const number = finite(value)
      if (number === undefined || (field.integer && !Number.isInteger(number))) return undefined
      if (field.kind === 'range' && (number < field.minimum! || number > field.maximum!))
        return undefined
      return number
    }
    case 'text':
      return typeof value === 'string' ? value : undefined
    case 'multi':
      return Array.isArray(value)
        ? field.options!.filter((option) => value.includes(option))
        : undefined
    default:
      return value === null ? undefined : value
  }
}

/** 没有保存值也没有默认值时控件实际显示的值；未列出的类型保持未设置。 */
function baseline(field: PluginSettingsField): unknown {
  if (field.kind === 'boolean') return false
  if (field.kind === 'range') return field.minimum
  if (field.kind === 'multi') return []
  return undefined
}

/** 表单初始值：已保存的配置优先，其次是 Schema 的 default。只包含 Schema 声明的属性。 */
// eslint-disable-next-line react-refresh/only-export-components
export function initialConfig(schema: unknown, config: Config = {}): Config {
  const result: Config = {}
  for (const field of schemaFields(schema)) {
    const value =
      accept(
        field,
        Object.prototype.hasOwnProperty.call(config, field.name) ? config[field.name] : undefined
      ) ??
      accept(field, field.default) ??
      baseline(field)
    if (value !== undefined) result[field.name] = value
  }
  return result
}

/**
 * 提交给服务端的配置：只写入 Schema 声明的属性。
 * additionalProperties 为 false 时未知键会被拒绝，因此丢弃；Schema 允许额外属性时保留原有的未知键，避免覆盖掉通过 JSON 写入的配置。
 */
// eslint-disable-next-line react-refresh/only-export-components
export function buildPluginConfig(schema: unknown, values: Config, current: Config = {}): Config {
  const fields = schemaFields(schema)
  const declared = new Set(fields.map((field) => field.name))
  const result: Config = {}
  if (isRecord(schema) && schema.additionalProperties !== false)
    for (const [key, value] of Object.entries(current)) if (!declared.has(key)) result[key] = value
  for (const field of fields)
    if (values[field.name] !== undefined) result[field.name] = values[field.name]
  return result
}

const serialize = (fields: PluginSettingsField[], values: Config) =>
  JSON.stringify(fields.map((field) => values[field.name] ?? null))

interface PluginSettingsFormProps {
  plugin: PluginState
  /** 草稿变化时通知宿主页面（无改动或草稿无效时为 null），用于「授权并启用」时一并提交 */
  onDraftChange?: (config: Config | null) => void
}

/** 按清单里的设置 Schema 生成表单，内置与第三方插件共用。草稿保存在组件内，保存后刷新插件目录。 */
export function PluginSettingsForm({ plugin, onDraftChange }: PluginSettingsFormProps) {
  const { t, i18n } = useTranslation('plugins')
  const { refresh } = usePlugins()
  const baseId = useId()
  const id = plugin.manifest.id
  const schema = plugin.manifest.settings
  const language = i18n.language
  const fields = useMemo(() => schemaFields(schema), [schema])
  const saved = useMemo(() => initialConfig(schema, plugin.config), [schema, plugin.config])
  const defaults = useMemo(() => initialConfig(schema), [schema])
  // null 表示没有改动，直接显示已保存的值，目录刷新后自动跟随
  const [draft, setDraft] = useState<Config | null>(null)
  // JSON 文本框的原始输入，解析失败时保留文本并阻止保存
  const [jsonText, setJsonText] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(() => Date.now() - (savedAt.get(id) ?? 0) < NOTICE_MS)

  const values = draft ?? saved
  const invalid = fields.filter((field) => {
    const text = jsonText[field.name]
    if (text === undefined || !text.trim()) return false
    try {
      JSON.parse(text)
      return false
    } catch {
      return true
    }
  })
  const dirty = draft !== null && serialize(fields, draft) !== serialize(fields, saved)
  const atDefaults = serialize(fields, values) === serialize(fields, defaults)
  const pending =
    dirty && invalid.length === 0
      ? JSON.stringify(buildPluginConfig(schema, values, plugin.config))
      : ''

  useEffect(() => {
    onDraftChange?.(pending ? (JSON.parse(pending) as Config) : null)
  }, [pending, onDraftChange])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(false), NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [notice])

  if (fields.length === 0) return null

  const locked = busy || plugin.disabled
  const text = (value: string) => localizedText(value, language)
  const change = (name: string, value: unknown) => {
    setDraft({ ...values, [name]: value })
    setNotice(false)
  }
  const reset = (next: Config | null) => {
    setDraft(next)
    setJsonText({})
    setError('')
    setNotice(false)
  }
  const save = async () => {
    setBusy(true)
    setError('')
    setNotice(false)
    try {
      await pluginAPI.save(
        plugin,
        plugin.enabled,
        buildPluginConfig(schema, values, plugin.config),
        plugin.grants
      )
      savedAt.set(id, Date.now())
      await refresh()
      setDraft(null)
      setJsonText({})
      setNotice(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('error'))
    } finally {
      setBusy(false)
    }
  }
  // 枚举值的可读名称放在 settingsOptions.<插件短 id>.<属性名>.<值>，没有登记时显示原值
  const optionLabel = (field: PluginSettingsField, option: string) =>
    /^[\w-]+$/.test(field.name) && /^[\w-]+$/.test(option)
      ? String(
          t(`settingsOptions.${pluginShortId(id)}.${field.name}.${option}`, {
            defaultValue: option,
          })
        )
      : option

  const control = (field: PluginSettingsField, labelId: string, hintId?: string) => {
    const value = values[field.name]
    const labelled = { 'aria-labelledby': labelId, 'aria-describedby': hintId }
    switch (field.kind) {
      case 'boolean':
        return (
          <Toggle
            checked={value === true}
            disabled={locked}
            onChange={(checked) => change(field.name, checked)}
            ariaLabel={text(field.title)}
          />
        )
      case 'segmented':
        return (
          <div className="plugin-form__segmented" role="radiogroup" {...labelled}>
            {field.options!.map((option) => (
              <label
                key={option}
                className="plugin-form__segment"
                data-checked={value === option}
                data-disabled={locked}
              >
                <input
                  type="radio"
                  name={baseId + field.name}
                  value={option}
                  checked={value === option}
                  disabled={locked}
                  onChange={() => change(field.name, option)}
                />
                <span>{optionLabel(field, option)}</span>
              </label>
            ))}
          </div>
        )
      case 'select':
        return (
          <select
            className="input plugin-form__input"
            value={typeof value === 'string' ? value : ''}
            disabled={locked}
            onChange={(event) => change(field.name, event.target.value || undefined)}
            {...labelled}
          >
            {(value === undefined || !field.required) && (
              <option value="">{t('form.unset')}</option>
            )}
            {field.options!.map((option) => (
              <option key={option} value={option}>
                {optionLabel(field, option)}
              </option>
            ))}
          </select>
        )
      case 'range':
        return (
          <div className="plugin-form__range">
            <input
              type="range"
              min={field.minimum}
              max={field.maximum}
              step={field.integer ? 1 : 'any'}
              value={typeof value === 'number' ? value : field.minimum}
              disabled={locked}
              onChange={(event) => change(field.name, Number(event.target.value))}
              {...labelled}
            />
            <output className="plugin-form__value">{String(value ?? field.minimum)}</output>
          </div>
        )
      case 'number':
        return (
          <input
            type="number"
            className="input plugin-form__input plugin-form__input--number"
            inputMode={field.integer ? 'numeric' : 'decimal'}
            min={field.minimum}
            max={field.maximum}
            step={field.integer ? 1 : 'any'}
            required={field.required}
            value={typeof value === 'number' ? value : ''}
            disabled={locked}
            onChange={(event) => {
              const number = event.target.value === '' ? NaN : Number(event.target.value)
              change(field.name, Number.isFinite(number) ? number : undefined)
            }}
            {...labelled}
          />
        )
      case 'text':
        return (
          <input
            type="text"
            className="input plugin-form__input"
            minLength={field.minLength}
            maxLength={field.maxLength}
            required={field.required}
            value={typeof value === 'string' ? value : ''}
            disabled={locked}
            // 清空可选项视为未设置；必填项或默认值非空的项保留空字符串，否则无法把默认值改成空
            onChange={(event) =>
              change(
                field.name,
                event.target.value || field.required || field.default
                  ? event.target.value
                  : undefined
              )
            }
            {...labelled}
          />
        )
      case 'multi': {
        const selected = Array.isArray(value) ? (value as string[]) : []
        const full = field.maxItems !== undefined && selected.length >= field.maxItems
        return (
          <div className="plugin-form__checks" role="group" {...labelled}>
            {field.options!.map((option) => (
              <label key={option} className="plugin-form__check">
                <input
                  type="checkbox"
                  checked={selected.includes(option)}
                  disabled={locked || (full && !selected.includes(option))}
                  onChange={(event) =>
                    change(
                      field.name,
                      // 按 Schema 的枚举顺序保存，避免勾选先后造成无意义的差异
                      field.options!.filter((item) =>
                        item === option ? event.target.checked : selected.includes(item)
                      )
                    )
                  }
                />
                <span>{optionLabel(field, option)}</span>
              </label>
            ))}
          </div>
        )
      }
      default: {
        const broken = invalid.includes(field)
        const errorId = baseId + field.name + '-error'
        return (
          <>
            <textarea
              className="input plugin-form__json"
              rows={3}
              spellCheck={false}
              value={
                jsonText[field.name] ?? (value === undefined ? '' : JSON.stringify(value, null, 2))
              }
              disabled={locked}
              aria-invalid={broken}
              aria-labelledby={labelId}
              aria-describedby={
                [hintId, broken ? errorId : ''].filter(Boolean).join(' ') || undefined
              }
              onChange={(event) => {
                const next = event.target.value
                setJsonText({ ...jsonText, [field.name]: next })
                if (!next.trim()) return change(field.name, undefined)
                try {
                  change(field.name, JSON.parse(next) ?? undefined)
                } catch {
                  // 输入到一半的 JSON 先保留文本，待可解析后再写入草稿
                  setNotice(false)
                }
              }}
            />
            {broken && (
              <p id={errorId} className="plugin-form__field-error">
                {t('form.invalidJSON')}
              </p>
            )}
          </>
        )
      }
    }
  }

  return (
    <div className="plugin-form" data-plugin-form={id} aria-busy={busy}>
      <div className="plugin-form__fields">
        {fields.map((field) => {
          const labelId = baseId + field.name + '-label'
          const hintId = field.description ? baseId + field.name + '-hint' : undefined
          return (
            <div
              key={field.name}
              className="plugin-form__field"
              data-kind={field.kind}
              // 开关组件不接受 aria-describedby，改由字段分组关联说明
              {...(field.kind === 'boolean'
                ? { role: 'group', 'aria-labelledby': labelId, 'aria-describedby': hintId }
                : {})}
            >
              <div className="plugin-form__text">
                <span id={labelId} className="plugin-form__label">
                  {text(field.title)}
                  {field.required && (
                    <span className="plugin-form__required" aria-hidden="true">
                      *
                    </span>
                  )}
                </span>
                {field.description && (
                  <p id={hintId} className="plugin-form__hint">
                    {text(field.description)}
                  </p>
                )}
              </div>
              <div className="plugin-form__control">{control(field, labelId, hintId)}</div>
            </div>
          )
        })}
      </div>
      {error && (
        <p role="alert" className="plugin-form__error">
          {error}
        </p>
      )}
      <div className="plugin-form__actions">
        {dirty && (
          <>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={locked || invalid.length > 0}
              onClick={() => void save()}
            >
              {t(busy ? 'form.saving' : 'form.save')}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              disabled={busy}
              onClick={() => reset(null)}
            >
              {t('form.revert')}
            </button>
          </>
        )}
        {notice && !dirty && (
          <p role="status" className="plugin-form__status">
            {t('form.saved')}
          </p>
        )}
        <button
          type="button"
          className="btn btn-sm btn-ghost plugin-form__reset"
          disabled={locked || atDefaults}
          onClick={() => reset(defaults)}
        >
          {t('form.restoreDefaults')}
        </button>
      </div>
    </div>
  )
}
