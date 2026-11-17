import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  decodeBase64URL,
  encodeBase64URL,
  passkeySupported,
  serializeCredential,
} from '../plugins/builtin/passkey/client'

vi.mock('@/lib/api-client', () => ({ apiClient: {} }))
vi.mock('@/services', () => ({ assertData: (data: unknown) => data }))
afterEach(() => vi.unstubAllGlobals())

describe('通行密钥浏览器协议', () => {
  it('完整保留签名和公钥中的任意字节，URL 编码不含填充', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i)
    const encoded = encodeBase64URL(bytes.buffer)
    expect(encoded).not.toMatch(/[+/=]/)
    expect(new Uint8Array(decodeBase64URL(encoded))).toEqual(bytes)
  })
  it('不安全环境或缺少 WebAuthn 时不显示登录能力', () => {
    vi.stubGlobal('window', { isSecureContext: false })
    vi.stubGlobal('navigator', { credentials: {} })
    vi.stubGlobal('PublicKeyCredential', class {})
    expect(passkeySupported()).toBe(false)
    vi.stubGlobal('window', { isSecureContext: true })
    expect(passkeySupported()).toBe(true)
    vi.stubGlobal('PublicKeyCredential', undefined)
    expect(passkeySupported()).toBe(false)
  })
  it('登录响应保留签名与账号句柄，注册响应包含认证器传输方式', () => {
    const bytes = new Uint8Array([0, 255, 18]).buffer
    const common = {
      id: 'AP8S',
      rawId: bytes,
      type: 'public-key',
      getClientExtensionResults: () => ({}),
    }
    const assertion = serializeCredential({
      ...common,
      response: {
        clientDataJSON: bytes,
        authenticatorData: bytes,
        signature: bytes,
        userHandle: bytes,
      },
    } as unknown as PublicKeyCredential)
    expect(assertion.response).toEqual({
      clientDataJSON: 'AP8S',
      authenticatorData: 'AP8S',
      signature: 'AP8S',
      userHandle: 'AP8S',
    })
    const creation = serializeCredential({
      ...common,
      response: {
        clientDataJSON: bytes,
        attestationObject: bytes,
        getTransports: () => ['internal'],
      },
    } as unknown as PublicKeyCredential)
    expect(creation.response).toEqual({
      clientDataJSON: 'AP8S',
      attestationObject: 'AP8S',
      transports: ['internal'],
    })
  })
})
