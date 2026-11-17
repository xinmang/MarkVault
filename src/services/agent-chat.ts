import { apiClient } from '@/lib/api-client'
import type { AIProvider } from '@/lib/ai/constants'

export interface AISettings {
  provider: AIProvider
  apiUrl: string
  model: string
  customPrompt: string
  enableCustomPrompt: boolean
  enabled: boolean
  hasApiKey: boolean
  hasPluginProvider?: boolean
  createdAt: string | null
  updatedAt: string | null
}

export interface SaveAISettingsInput
  extends Omit<AISettings, 'hasApiKey' | 'createdAt' | 'updatedAt'> {
  apiKey?: string
  clearApiKey?: boolean
}

export interface AgentChatInputMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface PendingAgentAction {
  id: string
  name: string
  title: string
  summary: string
  destructive: boolean
  arguments: Record<string, unknown>
  confirmation_token: string
  expires_at: string
}

export interface AgentChatResponse {
  message: AgentChatInputMessage
  pending_actions: PendingAgentAction[]
  model: string
}

export interface ConfirmAgentActionResponse {
  action: { name: string; title: string; summary: string }
  result: unknown
  data_changed: boolean
  message: string
}

export const agentChatService = {
  async getSettings(): Promise<AISettings> {
    const response = await apiClient.get<{ settings: AISettings }>('/settings/ai')
    if (!response.data?.settings) throw new Error('AI 设置响应无效')
    return response.data.settings
  },

  async saveSettings(input: SaveAISettingsInput): Promise<AISettings> {
    const response = await apiClient.put<{ settings: AISettings }>('/settings/ai', input)
    if (!response.data?.settings) throw new Error('AI 设置响应无效')
    return response.data.settings
  },

  async testConnection(): Promise<{ connected: boolean; latency: number; model: string }> {
    const response = await apiClient.post<{
      connected: boolean
      latency: number
      model: string
    }>('/settings/ai/test')
    if (!response.data) throw new Error('AI 测试响应无效')
    return response.data
  },

  async chat(messages: AgentChatInputMessage[], agentId?: string): Promise<AgentChatResponse> {
    const response = await apiClient.post<AgentChatResponse>('/agent/chat', { messages, agentId })
    if (!response.data) throw new Error('站内 Agent 响应无效')
    return response.data
  },

  async confirmAction(action: PendingAgentAction): Promise<ConfirmAgentActionResponse> {
    const response = await apiClient.post<ConfirmAgentActionResponse>('/agent/chat/confirm', {
      confirmation_token: action.confirmation_token,
    })
    if (!response.data) throw new Error('写操作确认响应无效')
    return response.data
  },

  async cancelAction(action: PendingAgentAction): Promise<void> {
    await apiClient.post('/agent/chat/cancel', {
      confirmation_token: action.confirmation_token,
    })
  },
}
