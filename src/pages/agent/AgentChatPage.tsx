import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Bot,
  Check,
  CircleCheck,
  KeyRound,
  LockKeyhole,
  MessageSquareText,
  RotateCcw,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  User,
  X,
} from 'lucide-react'
import {
  agentChatService,
  type AgentChatInputMessage,
  type AISettings,
  type PendingAgentAction,
} from '@/services/agent-chat'
import { useToastStore } from '@/stores/toastStore'
import { usePlugins } from '@/plugins/context'

interface ConversationMessage extends AgentChatInputMessage {
  id: string
  tone?: 'normal' | 'success' | 'error'
}

function createMessage(
  role: AgentChatInputMessage['role'],
  content: string,
  tone: ConversationMessage['tone'] = 'normal'
): ConversationMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    tone,
  }
}

export function AgentChatPage() {
  const { directory } = usePlugins()
  const [agentId, setAgentId] = useState('markvault.agent')
  const { t } = useTranslation('agent')
  const queryClient = useQueryClient()
  const addToast = useToastStore((state) => state.addToast)
  const [settings, setSettings] = useState<AISettings | null>(null)
  const [isSettingsLoading, setIsSettingsLoading] = useState(true)
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [pendingActions, setPendingActions] = useState<PendingAgentAction[]>([])
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [confirmingActionId, setConfirmingActionId] = useState<string | null>(null)
  const messageEndRef = useRef<HTMLDivElement>(null)

  const isConfigured = agentId !== 'markvault.agent' || Boolean(settings?.hasPluginProvider || (settings?.enabled && settings.hasApiKey))
  const hasPendingActions = pendingActions.length > 0
  const canSend = isConfigured && !hasPendingActions
  const examplePrompts = t('chat.examples', { returnObjects: true }) as string[]
  const conversationForApi = useMemo<AgentChatInputMessage[]>(
    () => messages.map(({ role, content }) => ({ role, content })).slice(-28),
    [messages]
  )

  useEffect(() => {
    agentChatService
      .getSettings()
      .then(setSettings)
      .catch((error: unknown) => {
        addToast('error', error instanceof Error ? error.message : t('chat.settingsLoadFailed'))
      })
      .finally(() => setIsSettingsLoading(false))
  }, [addToast, t])

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messages, pendingActions, isSending])

  const sendMessage = async () => {
    const content = input.trim()
    if (!content || isSending || !canSend) return

    const userMessage = createMessage('user', content)
    const nextConversation = [...conversationForApi, { role: 'user' as const, content }].slice(-30)
    setMessages((current) => [...current, userMessage])
    setInput('')
    setIsSending(true)

    try {
      const response = await agentChatService.chat(nextConversation, agentId)
      setMessages((current) => [...current, createMessage('assistant', response.message.content)])
      setPendingActions(response.pending_actions)
    } catch (error) {
      const message = error instanceof Error ? error.message : t('chat.sendFailed')
      setMessages((current) => [...current, createMessage('assistant', message, 'error')])
    } finally {
      setIsSending(false)
    }
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    void sendMessage()
  }

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void sendMessage()
    }
  }

  const confirmAction = async (action: PendingAgentAction) => {
    if (confirmingActionId) return
    setConfirmingActionId(action.id)
    try {
      const response = await agentChatService.confirmAction(action)
      setPendingActions((current) => current.filter((item) => item.id !== action.id))
      setMessages((current) => [
        ...current,
        createMessage('assistant', response.message, 'success'),
      ])
      await queryClient.invalidateQueries()
    } catch (error) {
      const message = error instanceof Error ? error.message : t('chat.confirmFailed')
      setMessages((current) => [...current, createMessage('assistant', message, 'error')])
    } finally {
      setConfirmingActionId(null)
    }
  }

  const cancelAction = async (action: PendingAgentAction) => {
    if (confirmingActionId) return
    setConfirmingActionId(action.id)
    try {
      await agentChatService.cancelAction(action)
      setPendingActions((current) => current.filter((item) => item.id !== action.id))
      setMessages((current) => [
        ...current,
        createMessage('assistant', t('chat.actionCancelled', { action: action.title })),
      ])
    } catch (error) {
      const message = error instanceof Error ? error.message : t('chat.cancelFailed')
      setMessages((current) => [...current, createMessage('assistant', message, 'error')])
    } finally {
      setConfirmingActionId(null)
    }
  }

  const clearConversation = async () => {
    const actionsToCancel = pendingActions
    setMessages([])
    setPendingActions([])
    setInput('')
    if (actionsToCancel.length > 0) {
      await Promise.allSettled(
        actionsToCancel.map((action) => agentChatService.cancelAction(action))
      )
    }
  }

  return (
    <div className="agent-chat-page relative mx-auto flex w-full max-w-6xl flex-col gap-4 pb-6">
      <select aria-label={t('chat.title')} value={agentId} disabled={isSending || hasPendingActions} className="bg-background border border-border rounded-lg p-2 self-start" onChange={event => { setAgentId(event.target.value); setMessages([]) }}>
        <option value="markvault.agent">MarkVault</option>
        {directory?.plugins.filter(p => p.status === 'running' && p.origin !== 'builtin').flatMap(p => p.manifest.contributes.filter(c => c.kind === 'agent').map(c => <option key={p.manifest.id + '/' + c.id} value={p.manifest.id + '/' + c.id}>{c.title}</option>))}
      </select>
      <header className="agent-chat-hero relative overflow-hidden rounded-2xl border border-border p-5 sm:p-6">
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex min-h-7 items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 text-xs font-bold uppercase tracking-[0.14em] text-primary">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                {t('chat.eyebrow')}
              </span>
              <span className="inline-flex min-h-7 items-center gap-2 rounded-full border border-border bg-card/80 px-3 text-xs font-semibold text-muted-foreground">
                <span
                  className={`h-2 w-2 rounded-full ${isConfigured ? 'bg-success' : 'bg-warning'} ${isSettingsLoading ? 'animate-pulse motion-reduce:animate-none' : ''}`}
                  aria-hidden="true"
                />
                {isSettingsLoading
                  ? t('chat.statusChecking')
                  : isConfigured
                    ? t('chat.statusReady')
                    : t('chat.statusSetupRequired')}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                <Bot className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h1 className="text-2xl font-black tracking-tight text-foreground sm:text-3xl">
                  {t('chat.title')}
                </h1>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                  {t('chat.description')}
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <button
              type="button"
              onClick={() => void clearConversation()}
              disabled={messages.length === 0 && pendingActions.length === 0}
              className="btn btn-outline min-h-11 cursor-pointer gap-2"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              {t('chat.clear')}
            </button>
            <Link
              to="/settings/general?section=ai"
              className="btn btn-primary min-h-11 cursor-pointer gap-2"
            >
              <Settings2 className="h-4 w-4" aria-hidden="true" />
              {t('chat.settings')}
            </Link>
          </div>
        </div>
      </header>

      {!isSettingsLoading && !isConfigured && (
        <section className="rounded-xl border border-warning/40 bg-warning/10 p-4" role="alert">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-none text-warning" aria-hidden="true" />
            <div>
              <h2 className="font-semibold text-foreground">{t('chat.notConfiguredTitle')}</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {t('chat.notConfiguredDescription')}
              </p>
              <Link
                to="/settings/general?section=ai"
                className="mt-2 inline-flex min-h-11 cursor-pointer items-center font-semibold text-primary hover:underline"
              >
                {t('chat.configureNow')}
              </Link>
            </div>
          </div>
        </section>
      )}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[17.5rem_minmax(0,1fr)]">
        <aside className="agent-chat-sidebar space-y-3 rounded-2xl border border-border bg-card/80 p-4 lg:sticky lg:top-24 lg:self-start">
          <section className="rounded-xl border border-border bg-background/70 p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-foreground">
              <CircleCheck className="h-4 w-4 text-success" aria-hidden="true" />
              {t('chat.connectionTitle')}
            </div>
            <dl className="mt-3 space-y-2 text-xs">
              <div className="flex items-start justify-between gap-3">
                <dt className="text-muted-foreground">{t('chat.provider')}</dt>
                <dd className="break-all text-right font-semibold text-foreground">
                  {settings?.provider || '—'}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="text-muted-foreground">{t('chat.model')}</dt>
                <dd className="break-all text-right font-semibold text-foreground">
                  {settings?.model || '—'}
                </dd>
              </div>
            </dl>
          </section>

          <section className="rounded-xl border border-primary/20 bg-primary/5 p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-foreground">
              <LockKeyhole className="h-4 w-4 text-primary" aria-hidden="true" />
              {t('chat.safetyTitle')}
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {t('chat.safetyDescription')}
            </p>
          </section>

          <section>
            <div className="flex items-center gap-2 px-1 text-sm font-bold text-foreground">
              <MessageSquareText className="h-4 w-4 text-primary" aria-hidden="true" />
              {t('chat.examplesTitle')}
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
              {examplePrompts.map((example) => (
                <button
                  key={example}
                  type="button"
                  disabled={!canSend}
                  onClick={() => setInput(example)}
                  className="agent-chat-prompt min-h-11 cursor-pointer rounded-xl border border-border bg-background/70 px-3 py-2 text-left text-sm leading-5 text-foreground transition-colors duration-200 hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {example}
                </button>
              ))}
            </div>
          </section>
        </aside>

        <section className="agent-chat-shell flex h-[38rem] min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card lg:h-[calc(100dvh-10rem)] lg:max-h-[46rem] lg:min-h-[36rem]">
          <div className="flex min-h-14 items-center justify-between gap-3 border-b border-border bg-muted/20 px-4">
            <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
              <KeyRound className="h-4 w-4 flex-none text-primary" aria-hidden="true" />
              <span className="truncate">{t('chat.privateSession')}</span>
            </div>
            {hasPendingActions && (
              <span className="rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-xs font-bold text-foreground">
                {t('chat.pendingCount', { count: pendingActions.length })}
              </span>
            )}
          </div>

          <div
            className="scrollbar-theme flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-6"
            role="log"
            aria-live="polite"
            aria-label={t('chat.messageList')}
          >
            {messages.length === 0 && (
              <div className="m-auto max-w-lg text-center">
                <div className="agent-chat-orb mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Bot className="h-8 w-8" aria-hidden="true" />
                </div>
                <h2 className="mt-5 text-xl font-bold text-foreground">{t('chat.welcomeTitle')}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {t('chat.welcomeDescription')}
                </p>
              </div>
            )}

            {messages.map((message) => {
              const isUser = message.role === 'user'
              return (
                <article
                  key={message.id}
                  className={`agent-chat-message flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}
                >
                  <div
                    className={`flex h-9 w-9 flex-none items-center justify-center rounded-xl ${
                      isUser
                        ? 'bg-primary text-primary-foreground'
                        : 'border border-border bg-background text-foreground'
                    }`}
                    aria-hidden="true"
                  >
                    {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                  </div>
                  <div
                    className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${
                      isUser
                        ? 'rounded-tr-md bg-primary text-primary-foreground'
                        : message.tone === 'error'
                          ? 'rounded-tl-md border border-error/30 bg-error/10 text-foreground'
                          : message.tone === 'success'
                            ? 'rounded-tl-md border border-success/30 bg-success/10 text-foreground'
                            : 'rounded-tl-md border border-border bg-background text-foreground'
                    }`}
                  >
                    {message.content}
                  </div>
                </article>
              )
            })}

            {pendingActions.map((action) => (
              <article
                key={action.id}
                className={`agent-chat-approval-card rounded-2xl border p-4 sm:ml-12 ${
                  action.destructive
                    ? 'is-destructive border-error/40 bg-error/5'
                    : 'border-warning/40 bg-warning/5'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`flex h-10 w-10 flex-none items-center justify-center rounded-xl ${
                      action.destructive ? 'bg-error/10 text-error' : 'bg-warning/10 text-warning'
                    }`}
                  >
                    {action.destructive ? (
                      <Trash2 className="h-5 w-5" aria-hidden="true" />
                    ) : (
                      <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                      {t('chat.approvalRequired')}
                    </p>
                    <h3 className="mt-1 font-bold text-foreground">{action.title}</h3>
                    <p className="mt-1 break-words text-sm text-muted-foreground">
                      {action.summary}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      {action.destructive ? t('chat.destructiveHint') : t('chat.confirmHint')}
                    </p>
                    <details className="mt-3 rounded-lg border border-border bg-background/70 text-xs">
                      <summary className="min-h-11 cursor-pointer px-3 py-3 font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60">
                        {t('chat.actionDetails')}
                      </summary>
                      <pre className="scrollbar-theme max-h-48 overflow-auto border-t border-border p-3 leading-5 text-muted-foreground">
                        {JSON.stringify(action.arguments, null, 2)}
                      </pre>
                    </details>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void confirmAction(action)}
                        disabled={Boolean(confirmingActionId)}
                        className={`btn min-h-11 cursor-pointer gap-2 ${
                          action.destructive
                            ? 'bg-error text-error-content hover:bg-error/90'
                            : 'btn-primary'
                        }`}
                      >
                        <Check className="h-4 w-4" aria-hidden="true" />
                        {confirmingActionId === action.id
                          ? t('chat.confirming')
                          : t('chat.confirm')}
                      </button>
                      <button
                        type="button"
                        onClick={() => void cancelAction(action)}
                        disabled={Boolean(confirmingActionId)}
                        className="btn btn-outline min-h-11 cursor-pointer gap-2"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                        {t('chat.cancel')}
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            ))}

            {isSending && (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span className="h-2 w-2 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
                {t('chat.thinking')}
              </div>
            )}
            <div ref={messageEndRef} />
          </div>

          <form
            onSubmit={handleSubmit}
            className="agent-chat-composer border-t border-border p-3 sm:p-4"
          >
            <label htmlFor="agent-chat-input" className="sr-only">
              {t('chat.inputLabel')}
            </label>
            <div className="flex items-end gap-2">
              <textarea
                id="agent-chat-input"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                rows={2}
                maxLength={8000}
                disabled={!canSend || isSending}
                aria-describedby="agent-chat-input-hint"
                placeholder={
                  hasPendingActions
                    ? t('chat.placeholderPending')
                    : isConfigured
                      ? t('chat.placeholder')
                      : t('chat.placeholderDisabled')
                }
                className="input min-h-14 flex-1 resize-y text-base sm:text-sm"
              />
              <button
                type="submit"
                disabled={!input.trim() || !canSend || isSending}
                className="btn btn-primary min-h-14 min-w-14 cursor-pointer px-4"
                aria-label={t('chat.send')}
                title={t('chat.send')}
              >
                <Send className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <p id="agent-chat-input-hint" className="mt-2 text-xs leading-5 text-muted-foreground">
              {hasPendingActions ? t('chat.resolvePendingHint') : t('chat.inputHint')}
            </p>
          </form>
        </section>
      </div>
    </div>
  )
}
