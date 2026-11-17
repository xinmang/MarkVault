import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiClient } from '@/lib/api-client'

interface Connection {
  id: string
  name: string
  url: string
  transport: string
  header: string
  tools: { name: string; description?: string }[]
  selected: string[]
  autoApproved: string[]
}
export function MCPConnections() {
  const { i18n } = useTranslation()
  const en = i18n.language.startsWith('en')
  const [connections, setConnections] = useState<Connection[]>([])
  const [name, setName] = useState('')
  const [url, setURL] = useState('')
  const [transport, setTransport] = useState('http')
  const [header, setHeader] = useState('')
  const [secret, setSecret] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const refresh = async () => {
    const result = await apiClient.get<{ connections: Connection[] }>('/plugins/mcp/connections')
    setConnections(result.data?.connections ?? [])
  }
  useEffect(() => {
    let alive = true
    apiClient
      .get<{ connections: Connection[] }>('/plugins/mcp/connections')
      .then((result) => {
        if (alive) setConnections(result.data?.connections ?? [])
      })
      .catch(() => {
        if (alive) setError(en ? 'Unable to load connections' : '读取连接失败')
      })
    return () => {
      alive = false
    }
  }, [en])
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="space-y-4 border border-border rounded-xl p-4">
      <h2 className="text-xl font-semibold">{en ? 'External MCP connections' : '外部 MCP 连接'}</h2>
      <p className="text-sm text-muted-foreground">
        {en
          ? 'Select tools for the assistant. Calls require confirmation unless you explicitly approve a tool as read-only.'
          : '选择提供给助手的工具。默认每次确认；仅在你核实工具只读后，才勾选允许免确认。'}
      </p>
      {error && (
        <p role="alert" className="text-red-500">
          {error}
        </p>
      )}
      {connections.map((c) => (
        <div key={c.id} className="border border-border rounded-lg p-3 space-y-3">
          <h3 className="font-semibold">{c.name}</h3>
          <p className="text-sm break-all">
            {c.url} · {c.transport}
          </p>
          <div className="flex gap-3">
            <button
              disabled={busy}
              className="btn btn-sm btn-secondary"
              onClick={() =>
                void run(() => apiClient.post('/plugins/mcp/connections/' + c.id + '/refresh'))
              }
            >
              {en ? 'Connect / refresh tools' : '连接并刷新工具'}
            </button>
            <button
              disabled={busy}
              className="btn btn-sm btn-ghost"
              onClick={() => {
                if (window.confirm(en ? 'Delete connection?' : '删除此连接及凭据？'))
                  void run(() => apiClient.delete('/plugins/mcp/connections/' + c.id))
              }}
            >
              {en ? 'Delete' : '删除'}
            </button>
          </div>
          {c.tools.map((tool) => (
            <div key={tool.name} className="space-y-2">
            <label className="flex gap-3 items-start">
              <input
                type="checkbox"
                disabled={busy}
                checked={c.selected.includes(tool.name)}
                onChange={(e) =>
                  void run(() =>
                    apiClient.put('/plugins/mcp/connections/' + c.id, {
                      ...c,
                      selected: e.target.checked
                        ? [...c.selected, tool.name]
                        : c.selected.filter((n) => n !== tool.name),
                      autoApproved: c.autoApproved.filter((n) => n !== tool.name),
                    })
                  )
                }
              />
              <span>
                {tool.name}
                <small className="block text-muted-foreground">{tool.description}</small>
              </span>
            </label>
            {c.selected.includes(tool.name) && <label className="flex gap-3 items-start ml-6 text-sm">
              <input type="checkbox" disabled={busy} checked={c.autoApproved.includes(tool.name)}
                onChange={(e) => void run(() => apiClient.put('/plugins/mcp/connections/' + c.id, {
                  ...c, autoApproved: e.target.checked ? [...c.autoApproved, tool.name] : c.autoApproved.filter((n) => n !== tool.name),
                }))} />
              {en ? 'I verified this tool is read-only and approve calls without confirmation' : '我已核实此工具只读，允许调用时免确认'}
            </label>}
            </div>
          ))}
        </div>
      ))}
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void run(async () => {
            await apiClient.post('/plugins/mcp/connections', {
              name,
              url,
              transport,
              header,
              secret,
              selected: [],
            })
            setSecret('')
            setName('')
            setURL('')
          })
        }}
      >
        <input
          required
          maxLength={120}
          className="bg-background p-2 border border-border rounded-lg"
          aria-label={en ? 'Connection name' : '连接名称'}
          placeholder={en ? 'Connection name' : '连接名称'}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          required
          type="url"
          className="bg-background p-2 border border-border rounded-lg"
          aria-label="MCP URL"
          placeholder="https://example.com/mcp"
          value={url}
          onChange={(e) => setURL(e.target.value)}
        />
        <select
          aria-label={en ? 'Transport' : '传输协议'}
          className="bg-background p-2 border border-border rounded-lg"
          value={transport}
          onChange={(e) => setTransport(e.target.value)}
        >
          <option value="http">Streamable HTTP</option>
          <option value="sse">HTTP / SSE</option>
        </select>
        <select
          aria-label={en ? 'Authentication' : '认证方式'}
          className="bg-background p-2 border border-border rounded-lg"
          value={header}
          onChange={(e) => setHeader(e.target.value)}
        >
          <option value="">{en ? 'No authentication' : '无需认证'}</option>
          <option value="Authorization">Bearer Token</option>
          <option value="X-API-Key">API Key (X-API-Key)</option>
        </select>
        {header && (
          <input
            type="password"
            autoComplete="off"
            className="bg-background p-2 border border-border rounded-lg"
            aria-label={en ? 'Credential' : '凭据'}
            placeholder={header === 'Authorization' ? 'Bearer …' : 'API Key'}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
        )}
        <button disabled={busy} className="btn btn-primary">
          {en ? 'Add connection' : '添加连接'}
        </button>
      </form>
    </section>
  )
}
