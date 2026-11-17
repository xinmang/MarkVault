export interface PluginSDK {
  config(): Promise<Record<string, unknown>>
  storage: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> }
  call(tool: string, args: Record<string, unknown>): Promise<unknown>
  fetch(
    url: string,
    credential?: string,
    options?: { method?: 'GET' | 'POST'; body?: string }
  ): Promise<{ status: number; body: string }>
  model(messages: { role: 'user' | 'assistant'; content: string }[]): Promise<{ content: string }>
}
export interface PluginInstance {
  invoke(contribution: string, arguments_: Record<string, unknown>): Promise<unknown> | unknown
  dispose?(): Promise<void> | void
}
export type Activate = (sdk: PluginSDK) => PluginInstance | Promise<PluginInstance>
export interface PageSDK {
  call(method: string, args?: Record<string, unknown>): Promise<unknown>
}
