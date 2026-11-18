import { create } from 'zustand'
import type { NoteTarget } from '@/lib/types'

interface NotesState {
  /** 当前打开备注弹窗的书签或标签页；null 表示弹窗关闭 */
  target: NoteTarget | null
  open: (target: NoteTarget) => void
  close: () => void
}

/**
 * 备注弹窗的全局开关。
 * 弹窗挂在应用根部而不是各个卡片里：卡片上的键盘、点击和拖拽处理不会收到弹窗内的事件，
 * 列表视图也不需要为每一行准备一份弹窗状态。
 */
export const useNotesStore = create<NotesState>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}))
