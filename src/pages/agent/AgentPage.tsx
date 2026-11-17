import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { featureSettingsPath } from '@/plugins/navigation'
import {
  ArrowRight,
  BookOpen,
  Bot,
  Check,
  CircleCheck,
  Clipboard,
  Code2,
  ExternalLink,
  FileJson,
  KeyRound,
  LockKeyhole,
  MessageSquareText,
  Network,
  Search,
  ShieldCheck,
  Sparkles,
  Tags,
  Puzzle,
} from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { AgentSignalScene } from './AgentSignalScene'
import './agent.css'

type TabId = 'skill' | 'api' | 'mcp' | 'security'
type HealthState = 'checking' | 'online' | 'offline'

interface CopyButtonProps {
  copyId: string
  copiedId: string | null
  onCopy: (copyId: string, value: string) => void
  value: string
}

async function copyToClipboard(value: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value)
    return
  }

  const textArea = document.createElement('textarea')
  textArea.value = value
  textArea.setAttribute('readonly', '')
  textArea.style.position = 'fixed'
  textArea.style.opacity = '0'
  document.body.appendChild(textArea)
  textArea.select()
  const copied = document.execCommand('copy')
  document.body.removeChild(textArea)
  if (!copied) throw new Error('Copy failed')
}

function CopyButton({ copyId, copiedId, onCopy, value }: CopyButtonProps) {
  const { t } = useTranslation('agent')
  const isCopied = copiedId === copyId

  return (
    <button
      type="button"
      onClick={() => onCopy(copyId, value)}
      className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:border-primary/60 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      aria-label={isCopied ? t('copy.copied') : t('copy.copy')}
    >
      {isCopied ? <Check className="h-4 w-4 text-success" /> : <Clipboard className="h-4 w-4" />}
      <span>{isCopied ? t('copy.copied') : t('copy.copy')}</span>
    </button>
  )
}

interface CodeBlockProps extends CopyButtonProps {
  label: string
}

function CodeBlock({ label, ...copyProps }: CodeBlockProps) {
  return (
    <div className="agent-code-block w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-border bg-background/70">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-3 py-2 sm:px-4">
        <span className="min-w-0 truncate text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </span>
        <CopyButton {...copyProps} />
      </div>
      <pre className="scrollbar-theme w-full min-w-0 max-w-full overflow-x-auto p-4 text-sm leading-6 text-foreground">
        <code>{copyProps.value}</code>
      </pre>
    </div>
  )
}

interface FeatureItemProps {
  icon: ReactNode
  title: string
  description: string
}

function FeatureItem({ icon, title, description }: FeatureItemProps) {
  return (
    <div className="agent-feature-card flex gap-3 rounded-xl border border-border bg-card p-4">
      <div className="agent-feature-icon flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-primary/10 text-primary">
        {icon}
      </div>
      <div className="min-w-0">
        <h3 className="font-semibold text-foreground">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

export function AgentPage() {
  const { t } = useTranslation('agent')
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const addToast = useToastStore((state) => state.addToast)
  const [activeTab, setActiveTab] = useState<TabId>('skill')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [health, setHealth] = useState<HealthState>('checking')

  const origin = window.location.origin
  const installPrompt = t('skill.installPrompt', { origin })
  const environmentExample = `MARKVAULT_BASE_URL=${origin}\nMARKVAULT_API_KEY=<在本地安全配置>`
  const clientExample = `node markvault-client.mjs me\nnode markvault-client.mjs search "Docker" --limit 10\nnode markvault-client.mjs create-tag "待读" --confirm\nnode markvault-client.mjs create-bookmark "文档" "https://example.com" --tags "待读" --confirm`
  const curlExample = `curl -sS "${origin}/api/v1/agent/search?q=Docker&limit=10" \\\n  -H "X-API-Key: $MARKVAULT_API_KEY"`
  const mcpExample = `curl -sS "${origin}/api/mcp" \\\n  -H "X-API-Key: $MARKVAULT_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -H "Accept: application/json, text/event-stream" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"my-agent","version":"1.0.0"}}}'`

  const tabs = useMemo(
    () => [
      { id: 'skill' as const, label: t('tabs.skill'), icon: Sparkles },
      { id: 'api' as const, label: t('tabs.api'), icon: Code2 },
      { id: 'mcp' as const, label: t('tabs.mcp'), icon: Network },
      { id: 'security' as const, label: t('tabs.security'), icon: ShieldCheck },
    ],
    [t]
  )

  useEffect(() => {
    const controller = new AbortController()

    fetch('/api/v1/agent', {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error('Agent API unavailable')
        return response.json()
      })
      .then(() => setHealth('online'))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setHealth('offline')
      })

    return () => controller.abort()
  }, [])

  const handleCopy = async (copyId: string, value: string) => {
    try {
      await copyToClipboard(value)
      setCopiedId(copyId)
      window.setTimeout(() => {
        setCopiedId((current) => (current === copyId ? null : current))
      }, 1800)
    } catch {
      setCopiedId(null)
      addToast('error', t('copy.failed'))
    }
  }

  const healthLabel = t(`health.${health}`)
  const healthHint =
    health === 'online'
      ? t('health.hintOnline')
      : health === 'offline'
        ? t('health.hintOffline')
        : t('health.hintChecking')
  const questionItems = t('questions.items', { returnObjects: true }) as string[]

  return (
    <div className="agent-access-page">
      <div className="agent-page-heading">
        <span>
          <Bot size={16} aria-hidden="true" /> {t('nav.label')}
        </span>
        <span className="agent-page-heading__index">MARKVAULT / CONNECT</span>
      </div>
      <section className="agent-access-hero" aria-labelledby="agent-hero-title">
        <div className="agent-hero-copy">
          <div className="agent-eyebrow">
            <span aria-hidden="true" />
            {t('hero.eyebrow')}
          </div>
          <h1 id="agent-hero-title">
            {t('hero.titleLead')}
            <br />
            <span>{t('hero.titleAccent')}</span>
          </h1>
          <p className="agent-hero-description">{t('hero.description')}</p>
          <div className="agent-hero-actions">
            <Link to={isAuthenticated ? '/agent/chat' : '/login'} className="btn btn-primary">
              <MessageSquareText size={16} />
              {isAuthenticated ? t('hero.primaryAuthenticated') : t('hero.primaryGuest')}
              <ArrowRight size={16} />
            </Link>
            <button
              type="button"
              onClick={() => handleCopy('hero-prompt', installPrompt)}
              className="btn btn-outline"
            >
              {copiedId === 'hero-prompt' ? <Check size={16} /> : <Clipboard size={16} />}
              {copiedId === 'hero-prompt' ? t('copy.copied') : t('hero.secondary')}
            </button>
          </div>
          <div className="agent-trust-row">
            <span>
              <ShieldCheck size={14} />
              {t('hero.readWrite')}
            </span>
            <span>
              <Network size={14} />
              {t('hero.mcp')}
            </span>
            <span>
              <KeyRound size={14} />
              {t('hero.apiKey')}
            </span>
          </div>
          {isAuthenticated && (
            <Link to="/settings/general?section=api" className="agent-key-link">
              {t('hero.manageKeys')}
              <ArrowRight size={14} />
            </Link>
          )}
        </div>
        <AgentSignalScene />
      </section>

      <section className="agent-connection-strip" aria-label={t('health.title')}>
        <div className="agent-connection-status" data-status={health} title={healthHint}>
          <span className="agent-status-dot" aria-hidden="true" />
          <div>
            <span className="agent-meta-label">{t('health.title')}</span>
            <strong aria-live="polite">{healthLabel}</strong>
          </div>
        </div>
        <div>
          <span className="agent-meta-label">{t('summary.authTitle')}</span>
          <strong>X-API-Key</strong>
        </div>
        <div>
          <span className="agent-meta-label">{t('summary.limitTitle')}</span>
          <strong>{t('summary.limitValue')}</strong>
        </div>
        <Link
          to={featureSettingsPath('markvault.browser-extension')}
          className="agent-extension-link"
        >
          <Puzzle size={18} />
          <span>
            {t('hero.extension')}
            <small>{t('hero.extensionHint')}</small>
          </span>
          <ArrowRight size={16} />
        </Link>
      </section>

      <section
        className="agent-access-tabs card min-w-0 max-w-full overflow-hidden"
        style={{ padding: 0 }}
      >
        <div className="agent-doc-tabs scrollbar-hide" role="tablist" aria-label={t('tabs.label')}>
          <div className="flex min-w-max gap-1 sm:gap-2">
            {tabs.map(({ id, label, icon: Icon }) => {
              const isActive = activeTab === id
              return (
                <button
                  key={id}
                  id={`agent-tab-${id}`}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`agent-panel-${id}`}
                  tabIndex={isActive ? 0 : -1}
                  onKeyDown={(event) => {
                    const current = tabs.findIndex((tab) => tab.id === id)
                    const next =
                      event.key === 'ArrowRight'
                        ? (current + 1) % tabs.length
                        : event.key === 'ArrowLeft'
                          ? (current - 1 + tabs.length) % tabs.length
                          : event.key === 'Home'
                            ? 0
                            : event.key === 'End'
                              ? tabs.length - 1
                              : -1
                    if (next < 0) return
                    event.preventDefault()
                    const nextId = tabs[next]!.id
                    setActiveTab(nextId)
                    document.getElementById('agent-tab-' + nextId)?.focus()
                  }}
                  onClick={() => setActiveTab(id)}
                  className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 sm:px-4 sm:text-sm ${
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-card hover:text-foreground'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="p-4 sm:p-6 lg:p-8">
          {activeTab === 'skill' && (
            <div
              id="agent-panel-skill"
              role="tabpanel"
              aria-labelledby="agent-tab-skill"
              className="space-y-6"
            >
              <div>
                <h2 className="text-2xl font-bold text-foreground">{t('skill.title')}</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                  {t('skill.description')}
                </p>
              </div>

              <CodeBlock
                label={t('skill.promptLabel')}
                copyId="install-prompt"
                copiedId={copiedId}
                onCopy={handleCopy}
                value={installPrompt}
              />

              <div className="grid gap-5 lg:grid-cols-2">
                <div className="min-w-0 space-y-3">
                  <div>
                    <h3 className="font-bold text-foreground">{t('skill.environmentTitle')}</h3>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {t('skill.environmentDescription')}
                    </p>
                  </div>
                  <CodeBlock
                    label=".env"
                    copyId="environment"
                    copiedId={copiedId}
                    onCopy={handleCopy}
                    value={environmentExample}
                  />
                </div>
                <div className="min-w-0 space-y-3">
                  <h3 className="font-bold text-foreground">{t('skill.clientLabel')}</h3>
                  <CodeBlock
                    label="terminal"
                    copyId="client"
                    copiedId={copiedId}
                    onCopy={handleCopy}
                    value={clientExample}
                  />
                </div>
              </div>

              <div>
                <h3 className="mb-3 font-bold text-foreground">{t('skill.stepsTitle')}</h3>
                <div className="grid gap-3 md:grid-cols-3">
                  {[
                    [t('skill.steps.keyTitle'), t('skill.steps.keyDescription')],
                    [t('skill.steps.envTitle'), t('skill.steps.envDescription')],
                    [t('skill.steps.verifyTitle'), t('skill.steps.verifyDescription')],
                  ].map(([title, description], index) => (
                    <div key={title} className="rounded-xl border border-border bg-muted/20 p-4">
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-black text-primary-foreground">
                        {index + 1}
                      </span>
                      <h4 className="mt-3 font-semibold text-foreground">{title}</h4>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'api' && (
            <div
              id="agent-panel-api"
              role="tabpanel"
              aria-labelledby="agent-tab-api"
              className="space-y-6"
            >
              <div>
                <h2 className="text-2xl font-bold text-foreground">{t('api.title')}</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                  {t('api.description')}
                </p>
              </div>

              <div>
                <h3 className="mb-3 font-bold text-foreground">{t('api.endpointsTitle')}</h3>
                <div className="grid gap-3 lg:grid-cols-2">
                  {[
                    {
                      method: 'GET',
                      path: '/api/v1/agent/search',
                      description: t('api.endpoints.search'),
                      icon: Search,
                    },
                    {
                      method: 'GET / POST',
                      path: '/api/v1/agent/bookmarks',
                      description: t('api.endpoints.bookmarks'),
                      icon: FileJson,
                    },
                    {
                      method: 'GET / PATCH / DELETE',
                      path: '/api/v1/agent/bookmarks/:id',
                      description: t('api.endpoints.bookmark'),
                      icon: BookOpen,
                    },
                    {
                      method: 'GET / POST',
                      path: '/api/v1/agent/tags',
                      description: t('api.endpoints.tags'),
                      icon: Tags,
                    },
                    {
                      method: 'GET / PATCH / DELETE',
                      path: '/api/v1/agent/tags/:id',
                      description: t('api.endpoints.tag'),
                      icon: KeyRound,
                    },
                  ].map(({ method, path, description, icon: EndpointIcon }) => {
                    return (
                      <div
                        key={path}
                        className="agent-endpoint-card flex items-start gap-3 rounded-xl border border-border bg-card p-4"
                      >
                        <EndpointIcon className="mt-0.5 h-5 w-5 flex-none text-primary" />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-black text-primary">
                              {method}
                            </span>
                            <code className="break-all text-sm font-semibold text-foreground">
                              {path}
                            </code>
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <CodeBlock
                label={t('api.curlTitle')}
                copyId="curl"
                copiedId={copiedId}
                onCopy={handleCopy}
                value={curlExample}
              />

              <div>
                <h3 className="font-bold text-foreground">{t('api.resourcesTitle')}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('api.resourcesDescription')}
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    ['/openapi-agent.json', t('api.resourceOpenApi')],
                    ['/llms.txt', t('api.resourceLlms')],
                    ['/markvault/SKILL.md', t('api.resourceSkill')],
                    ['/markvault/references/api.md', t('api.resourceReference')],
                  ].map(([href, label]) => (
                    <a
                      key={href}
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center justify-between gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:border-primary/60 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                    >
                      <span>{label}</span>
                      <ExternalLink className="h-4 w-4 text-primary" />
                    </a>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'mcp' && (
            <div
              id="agent-panel-mcp"
              role="tabpanel"
              aria-labelledby="agent-tab-mcp"
              className="space-y-6"
            >
              <div>
                <h2 className="text-2xl font-bold text-foreground">{t('mcp.title')}</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                  {t('mcp.description')}
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <FeatureItem
                  icon={<Network className="h-5 w-5" />}
                  title={t('mcp.items.transportTitle')}
                  description={t('mcp.items.transportDescription', { origin })}
                />
                <FeatureItem
                  icon={<KeyRound className="h-5 w-5" />}
                  title={t('mcp.items.permissionTitle')}
                  description={t('mcp.items.permissionDescription')}
                />
                <FeatureItem
                  icon={<ShieldCheck className="h-5 w-5" />}
                  title={t('mcp.items.confirmTitle')}
                  description={t('mcp.items.confirmDescription')}
                />
              </div>

              <CodeBlock
                label={t('mcp.exampleTitle')}
                copyId="mcp-example"
                copiedId={copiedId}
                onCopy={handleCopy}
                value={mcpExample}
              />

              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                <div className="flex items-start gap-3">
                  <Bot className="mt-0.5 h-5 w-5 flex-none text-primary" />
                  <div>
                    <h3 className="font-bold text-foreground">{t('mcp.toolsTitle')}</h3>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {t('mcp.toolsDescription')}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div
              id="agent-panel-security"
              role="tabpanel"
              aria-labelledby="agent-tab-security"
              className="space-y-6"
            >
              <div>
                <h2 className="text-2xl font-bold text-foreground">{t('security.title')}</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                  {t('security.description')}
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <FeatureItem
                  icon={<LockKeyhole className="h-5 w-5" />}
                  title={t('security.items.permissionTitle')}
                  description={t('security.items.permissionDescription')}
                />
                <FeatureItem
                  icon={<ShieldCheck className="h-5 w-5" />}
                  title={t('security.items.leastPrivilegeTitle')}
                  description={t('security.items.leastPrivilegeDescription')}
                />
                <FeatureItem
                  icon={<KeyRound className="h-5 w-5" />}
                  title={t('security.items.mcpTitle')}
                  description={t('security.items.mcpDescription')}
                />
                <FeatureItem
                  icon={<MessageSquareText className="h-5 w-5" />}
                  title={t('security.items.chatTitle')}
                  description={t('security.items.chatDescription')}
                />
              </div>

              <div className="rounded-xl border border-warning/30 bg-warning/10 p-4">
                <h3 className="font-bold text-foreground">{t('security.boundaryTitle')}</h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {t('security.boundaryDescription')}
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="agent-questions min-w-0 max-w-full rounded-2xl border border-border bg-card p-5 sm:p-7">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Search className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">{t('questions.title')}</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {t('questions.description')}
            </p>
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {questionItems.map((question) => (
            <div
              key={question}
              className="flex items-start gap-3 rounded-xl border border-border bg-muted/20 p-4 text-sm leading-6 text-foreground"
            >
              <CircleCheck className="mt-0.5 h-4 w-4 flex-none text-success" />
              <span>{question}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
