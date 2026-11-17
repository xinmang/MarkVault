import { apiClient } from '@/lib/api-client'
import type { LoginResponse } from '@/lib/types'
import { assertData } from '@/services'

export interface PasskeyEntry {
  id: string
  name: string
  rp_id: string
  created_at: string
  last_used_at: string | null
}

type EncodedDescriptor = Omit<PublicKeyCredentialDescriptor, 'id'> & { id: string }
type CreationJSON = Omit<
  PublicKeyCredentialCreationOptions,
  'challenge' | 'user' | 'excludeCredentials'
> & {
  challenge: string
  user: Omit<PublicKeyCredentialUserEntity, 'id'> & { id: string }
  excludeCredentials?: EncodedDescriptor[]
}
type RequestJSON = Omit<PublicKeyCredentialRequestOptions, 'challenge' | 'allowCredentials'> & {
  challenge: string
  allowCredentials?: EncodedDescriptor[]
}

export function passkeySupported() {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof PublicKeyCredential !== 'undefined' &&
    Boolean(navigator.credentials)
  )
}

export function decodeBase64URL(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const bytes = Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), (c) =>
    c.charCodeAt(0)
  )
  return bytes.buffer
}

export function encodeBase64URL(value: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(value)))
    .split('+')
    .join('-')
    .split('/')
    .join('_')
    .replace(/=+$/, '')
}

/** 显式转换二进制字段，兼容尚未支持 WebAuthn JSON 辅助方法的浏览器。 */
export function serializeCredential(credential: PublicKeyCredential) {
  const response = credential.response
  const common = {
    id: credential.id,
    rawId: encodeBase64URL(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
  }
  if ('attestationObject' in response) {
    const attestation = response as AuthenticatorAttestationResponse
    return {
      ...common,
      response: {
        clientDataJSON: encodeBase64URL(response.clientDataJSON),
        attestationObject: encodeBase64URL(attestation.attestationObject),
        transports: attestation.getTransports?.() ?? [],
      },
    }
  }
  const assertion = response as AuthenticatorAssertionResponse
  return {
    ...common,
    response: {
      clientDataJSON: encodeBase64URL(response.clientDataJSON),
      authenticatorData: encodeBase64URL(assertion.authenticatorData),
      signature: encodeBase64URL(assertion.signature),
      userHandle: assertion.userHandle ? encodeBase64URL(assertion.userHandle) : null,
    },
  }
}

export async function registerPasskey(name: string, password: string) {
  const begin = assertData(
    (
      await apiClient.post<{ session_id: string; options: { publicKey: CreationJSON } }>(
        '/auth/passkey/register/begin',
        { name, password }
      )
    ).data,
    '开始绑定通行密钥'
  )
  const options = begin.options.publicKey
  const credential = (await navigator.credentials.create({
    publicKey: {
      ...options,
      challenge: decodeBase64URL(options.challenge),
      user: { ...options.user, id: decodeBase64URL(options.user.id) },
      excludeCredentials: options.excludeCredentials?.map((item) => ({
        ...item,
        id: decodeBase64URL(item.id),
      })),
    },
  })) as PublicKeyCredential | null
  if (!credential) throw new DOMException('操作已取消', 'NotAllowedError')
  await apiClient.post('/auth/passkey/register/finish', {
    session_id: begin.session_id,
    credential: serializeCredential(credential),
  })
}

export async function loginWithPasskey(): Promise<LoginResponse> {
  const begin = assertData(
    (
      await apiClient.post<{ session_id: string; options: { publicKey: RequestJSON } }>(
        '/auth/passkey/login/begin',
        {}
      )
    ).data,
    '开始通行密钥登录'
  )
  const options = begin.options.publicKey
  const credential = (await navigator.credentials.get({
    publicKey: {
      ...options,
      challenge: decodeBase64URL(options.challenge),
      allowCredentials: options.allowCredentials?.map((item) => ({
        ...item,
        id: decodeBase64URL(item.id),
      })),
    },
  })) as PublicKeyCredential | null
  if (!credential) throw new DOMException('操作已取消', 'NotAllowedError')
  return assertData(
    (
      await apiClient.post<LoginResponse>('/auth/passkey/login/finish', {
        session_id: begin.session_id,
        credential: serializeCredential(credential),
      })
    ).data,
    '完成通行密钥登录'
  )
}
