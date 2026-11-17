import { useEffect, useRef, useState } from 'react'
import type { PluginState } from '@shared/plugin-types'
import { useAuthStore } from '@/stores/authStore'
import { pluginAPI } from './api'

// 脚本与样式只能来自此文档，禁止网络、表单、弹窗、父页导航和同源身份。
const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'"
export function SandboxPanel({ plugin, entry }: { plugin: PluginState; entry: string }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [document, setDocument] = useState('')
  const [error, setError] = useState('')
  const session = useAuthStore((state) => state.accessToken)
  useEffect(() => {
    let disposed = false
    const nonce = crypto.randomUUID()
    const captured = useAuthStore.getState()
    setDocument('')
    setError('')
    const listener = async (event: MessageEvent) => {
      if (
        disposed ||
        event.source !== frame.current?.contentWindow ||
        event.origin !== 'null' ||
        useAuthStore.getState().user?.id !== captured.user?.id ||
        useAuthStore.getState().accessToken !== captured.accessToken
      )
        return
      const message = event.data
      if (
        !message ||
        message.channel !== nonce ||
        typeof message.id !== 'number' ||
        typeof message.method !== 'string' ||
        message.type !== 'rpc'
      )
        return
      try {
        if (JSON.stringify(message).length > 65536) return
      } catch {
        return
      }
      try {
        const value = await pluginAPI.rpc(plugin, message.method, message.args ?? {})
        if (!disposed && useAuthStore.getState().sessionVersion === captured.sessionVersion)
          frame.current?.contentWindow?.postMessage({ channel: nonce, id: message.id, value }, '*')
      } catch {
        if (!disposed && useAuthStore.getState().sessionVersion === captured.sessionVersion)
          frame.current?.contentWindow?.postMessage(
            { channel: nonce, id: message.id, error: '宿主拒绝调用 / Request denied' },
            '*'
          )
      }
    }
    window.addEventListener('message', listener)
    const bridge =
      `<script>(()=>{const channel=` +
      JSON.stringify(nonce) +
      `;let sequence=0;const pending=new Map();window.markvault=Object.freeze({call:(method,args={})=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Timeout'))},30000);pending.set(id,{resolve,reject,timer});parent.postMessage({channel,type:'rpc',id,method,args},'*')})});addEventListener('message',event=>{if(event.source!==parent||event.data?.channel!==channel)return;const item=pending.get(event.data.id);if(!item)return;clearTimeout(item.timer);pending.delete(event.data.id);event.data.error?item.reject(new Error(event.data.error)):item.resolve(event.data.value)})})()</script>`
    pluginAPI
      .asset(plugin, entry)
      .then((html) => {
        if (!disposed)
          setDocument(
            '<!doctype html><meta http-equiv="Content-Security-Policy" content="' +
              CSP +
              '"><meta name="referrer" content="no-referrer">' +
              bridge +
              html
          )
      })
      .catch(() => {
        if (!disposed) setError('插件界面加载失败 / Unable to load plugin')
      })
    return () => {
      disposed = true
      window.removeEventListener('message', listener)
    }
  }, [plugin, entry, session])
  if (error) return <p role="alert">{error}</p>
  if (!document) return <p role="status">正在加载插件 / Loading plugin…</p>
  return (
    <iframe
      ref={frame}
      title={plugin.manifest.name}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={document}
      className="w-full min-h-[480px] rounded-xl border border-border bg-background"
    />
  )
}
