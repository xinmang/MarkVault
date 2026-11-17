import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, KeyRound, Link2, MessageSquareText, Save, TestTube2, Trash2 } from 'lucide-react'
import { AI_DEFAULT_MODELS, AI_SERVICE_URLS, type AIProvider } from '@/lib/ai/constants'
import { agentChatService, type AISettings } from '@/services/agent-chat'
import { useToastStore } from '@/stores/toastStore'
import { SettingsSection, SettingsDivider } from '../SettingsSection'
import { SettingsSwitchRow } from '../SettingsSwitchRow'
import { InfoBox } from '../InfoBox'

const PROVIDERS: Array<{ value: AIProvider; label: string }> = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'claude', label: 'Anthropic Claude' },
  { value: 'siliconflow', label: 'SiliconFlow' },
  { value: 'modelscope', label: 'ModelScope' },
  { value: 'custom', label: 'OpenAI Compatible' },
]

const EMPTY_SETTINGS: AISettings = {
  provider: 'openai',
  apiUrl: '',
  model: AI_DEFAULT_MODELS.openai,
  customPrompt: '',
  enableCustomPrompt: false,
  enabled: false,
  hasApiKey: false,
  createdAt: null,
  updatedAt: null,
}

export function AiSettingsTab() {
  const { t } = useTranslation('settings')
  const addToast = useToastStore((state) => state.addToast)
  const [settings, setSettings] = useState<AISettings>(EMPTY_SETTINGS)
  const [apiKey, setApiKey] = useState('')
  const [clearApiKey, setClearApiKey] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)

  useEffect(() => {
    agentChatService
      .getSettings()
      .then(setSettings)
      .catch((error: unknown) => {
        addToast('error', error instanceof Error ? error.message : t('ai.loadFailed'))
      })
      .finally(() => setIsLoading(false))
  }, [addToast, t])

  const update = <K extends keyof AISettings>(key: K, value: AISettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }))
  }

  const handleProviderChange = (provider: AIProvider) => {
    setSettings((current) => ({
      ...current,
      provider,
      apiUrl: provider === 'custom' ? current.apiUrl : '',
      model: AI_DEFAULT_MODELS[provider] || current.model,
    }))
  }

  const save = async (showToast = true): Promise<boolean> => {
    setIsSaving(true)
    try {
      const saved = await agentChatService.saveSettings({
        provider: settings.provider,
        apiUrl: settings.apiUrl,
        model: settings.model,
        customPrompt: settings.customPrompt,
        enableCustomPrompt: settings.enableCustomPrompt,
        enabled: settings.enabled,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        clearApiKey,
      })
      setSettings(saved)
      setApiKey('')
      setClearApiKey(false)
      if (showToast) addToast('success', t('ai.saveSuccess'))
      return true
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : t('ai.saveFailed'))
      return false
    } finally {
      setIsSaving(false)
    }
  }

  const handleTest = async () => {
    setIsTesting(true)
    try {
      if (!(await save(false))) return
      const result = await agentChatService.testConnection()
      addToast('success', t('ai.testSuccess', { latency: result.latency }))
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : t('ai.testFailed'))
    } finally {
      setIsTesting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center" aria-label={t('ai.loading')}>
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-b-primary motion-reduce:animate-none" />
      </div>
    )
  }

  const providerLabel = PROVIDERS.find((provider) => provider.value === settings.provider)?.label

  return (
    <div className="space-y-6">
      <SettingsSection icon={Bot} title={t('ai.title')}>
        <div className="space-y-5">
          <SettingsSwitchRow
            title={t('ai.enable')}
            description={t('ai.enableHint')}
            icon={MessageSquareText}
            checked={settings.enabled}
            onChange={(checked) => update('enabled', checked)}
          />

          <div className="settings-form-list grid gap-4 md:grid-cols-2">
            <label className="settings-inline-field block space-y-2">
              <span className="text-sm font-semibold text-foreground">{t('ai.provider')}</span>
              <select
                className="input min-h-11"
                value={settings.provider}
                onChange={(event) => handleProviderChange(event.target.value as AIProvider)}
              >
                {PROVIDERS.map((provider) => (
                  <option key={provider.value} value={provider.value}>
                    {provider.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="settings-inline-field block space-y-2">
              <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Bot className="h-4 w-4 text-primary" />
                {t('ai.model')}
              </span>
              <input
                className="input min-h-11"
                value={settings.model}
                onChange={(event) => update('model', event.target.value)}
                placeholder={AI_DEFAULT_MODELS[settings.provider] || t('ai.modelPlaceholder')}
              />
            </label>
          </div>

          <label className="settings-inline-field block space-y-2">
            <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Link2 className="h-4 w-4 text-primary" />
              {t('ai.apiUrl')}
            </span>
            <input
              className="input min-h-11"
              value={settings.apiUrl}
              onChange={(event) => update('apiUrl', event.target.value)}
              placeholder={AI_SERVICE_URLS[settings.provider] || 'https://example.com/v1'}
            />
            <p className="text-xs leading-5 text-muted-foreground">{t('ai.apiUrlHint')}</p>
          </label>

          <div className="settings-inline-field space-y-2">
            <label
              htmlFor="agent-api-key"
              className="flex items-center gap-2 text-sm font-semibold text-foreground"
            >
              <KeyRound className="h-4 w-4 text-primary" />
              {t('ai.apiKey')}
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id="agent-api-key"
                type="password"
                autoComplete="off"
                className="input min-h-11 flex-1"
                value={apiKey}
                disabled={clearApiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={
                  settings.hasApiKey && !clearApiKey
                    ? t('ai.apiKeySavedPlaceholder')
                    : t('ai.apiKeyPlaceholder', { provider: providerLabel })
                }
              />
              {settings.hasApiKey && (
                <button
                  type="button"
                  onClick={() => {
                    setClearApiKey((current) => !current)
                    setApiKey('')
                  }}
                  className={`btn btn-sm min-h-11 gap-2 ${clearApiKey ? 'btn-primary' : 'btn-ghost'}`}
                >
                  <Trash2 className="h-4 w-4" />
                  {clearApiKey ? t('ai.keepApiKey') : t('ai.clearApiKey')}
                </button>
              )}
            </div>
            <p className="text-xs leading-5 text-muted-foreground">{t('ai.apiKeyHint')}</p>
          </div>

          <SettingsDivider />

          <div className="space-y-3">
            <SettingsSwitchRow
              title={t('ai.customPrompt')}
              description={t('ai.customPromptHint')}
              checked={settings.enableCustomPrompt}
              onChange={(checked) => update('enableCustomPrompt', checked)}
            />
            {settings.enableCustomPrompt && (
              <textarea
                className="input min-h-32 resize-y"
                value={settings.customPrompt}
                onChange={(event) => update('customPrompt', event.target.value)}
                placeholder={t('ai.customPromptPlaceholder')}
              />
            )}
          </div>

          <div className="settings-form-actions flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={isSaving || isTesting}
              onClick={handleTest}
              className="btn btn-outline min-h-11 gap-2"
            >
              <TestTube2
                className={`h-4 w-4 ${isTesting ? 'animate-pulse motion-reduce:animate-none' : ''}`}
              />
              {isTesting ? t('ai.testing') : t('ai.testConnection')}
            </button>
            <button
              type="button"
              disabled={isSaving || isTesting}
              onClick={() => void save()}
              className="btn btn-primary min-h-11 gap-2"
            >
              <Save className="h-4 w-4" />
              {isSaving ? t('ai.saving') : t('ai.save')}
            </button>
          </div>
        </div>
      </SettingsSection>

      <InfoBox icon={KeyRound} title={t('ai.infoBox.title')} variant="info">
        <ul className="space-y-1 text-xs leading-5">
          <li>• {t('ai.infoBox.tip1')}</li>
          <li>• {t('ai.infoBox.tip2')}</li>
          <li>• {t('ai.infoBox.tip3')}</li>
        </ul>
      </InfoBox>
    </div>
  )
}
