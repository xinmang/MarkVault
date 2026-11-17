import { createContext } from 'react'

/** 公开页将分享别名传给点击记录逻辑，不改变各组件的只读编辑权限。 */
export const PublicShareSlugContext = createContext<string | null>(null)
