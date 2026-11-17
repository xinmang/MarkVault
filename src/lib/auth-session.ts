import type { User } from '@/lib/types'

/**
 * 认证会话快照。
 *
 * 只保存判断“这次异步刷新/重试属于哪个会话”所需的最小信息，
 * 避免在 await 之后继续使用旧的对象引用做判断。
 */
export interface AuthSessionSnapshot {
  userId: string | null
  /** 会话代次：登录成功、登出/清理都会递增，令牌轮换不变 */
  sessionVersion: number
  refreshToken: string | null
  accessToken: string | null
}

/** 认证 store 中与会话归属相关的字段。 */
export interface AuthStateLike {
  user: User | null
  accessToken: string | null
  refreshToken: string | null
  sessionVersion: number
}

/**
 * 刷新结果已不再属于发起时的会话（登出或切换账号）。
 *
 * 抛出这个错误的调用方不应写入令牌，也不应清理或跳转登录，
 * 否则会把旧账号的异步结果污染到新会话上。
 */
export class AuthSessionChangedError extends Error {
  constructor(message = '认证会话已变更，已丢弃过期的刷新结果') {
    super(message)
    this.name = 'AuthSessionChangedError'
  }
}

export function snapshotAuthSession(state: AuthStateLike): AuthSessionSnapshot {
  return {
    userId: state.user?.id ?? null,
    sessionVersion: state.sessionVersion,
    refreshToken: state.refreshToken,
    accessToken: state.accessToken,
  }
}

/**
 * 是否仍是同一次登录会话：账号、代次与刷新令牌都未变化。
 * 刷新令牌每次轮换，因此刷新结果只能写回完全一致的会话。
 */
export function isSameAuthSession(a: AuthSessionSnapshot, b: AuthSessionSnapshot): boolean {
  return isSameAuthGeneration(a, b) && a.refreshToken === b.refreshToken
}

/**
 * 是否属于同一个登录会话代次：账号与代次都未变化。
 * 同一会话内的令牌轮换仍算同代次，可以复用新令牌重试；
 * 同一账号重新登录后代次会变，旧请求不得再用新凭据重放。
 */
export function isSameAuthGeneration(a: AuthSessionSnapshot, b: AuthSessionSnapshot): boolean {
  return a.userId === b.userId && a.sessionVersion === b.sessionVersion
}
