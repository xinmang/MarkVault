import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import { Z_INDEX } from '@/lib/constants/z-index'

export interface MenuItem {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  divider?: boolean // 在此项之前显示分隔线
  /** 单选菜单用：传入布尔值后该项按单选项呈现，true 表示当前项（主色文字，右侧带选中标记） */
  selected?: boolean
}

interface DropdownMenuProps {
  trigger: React.ReactNode
  items: MenuItem[]
  align?: 'left' | 'right'
}

export function DropdownMenu({ trigger, items, align = 'right' }: DropdownMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, right: 0 })
  const triggerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // 更新菜单位置
  useEffect(() => {
    if (isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setMenuPosition({
        top: rect.bottom + 4, // 4px gap
        left: align === 'left' ? rect.left : 0,
        right: align === 'right' ? window.innerWidth - rect.right : 0,
      })
    }
  }, [isOpen, align])

  // 调整菜单位置，确保不超出屏幕
  useEffect(() => {
    if (isOpen && menuRef.current && triggerRef.current) {
      const menuRect = menuRef.current.getBoundingClientRect()
      const triggerRect = triggerRef.current.getBoundingClientRect()
      const gap = 4
      const padding = 10 // 距离屏幕边缘的最小距离

      let adjustedTop = triggerRect.bottom + gap
      let adjustedLeft = menuPosition.left
      let adjustedRight = menuPosition.right

      // 检查垂直方向溢出
      if (adjustedTop + menuRect.height > window.innerHeight) {
        // 尝试显示在触发器上方
        const topPosition = triggerRect.top - menuRect.height - gap
        if (topPosition >= padding) {
          adjustedTop = topPosition
        } else {
          // 如果上方也放不下，则贴近屏幕底部
          adjustedTop = window.innerHeight - menuRect.height - padding
        }
      }

      // 检查水平方向溢出
      if (align === 'left') {
        // 左对齐：检查右侧是否溢出
        if (adjustedLeft + menuRect.width > window.innerWidth - padding) {
          adjustedLeft = window.innerWidth - menuRect.width - padding
        }
        // 检查左侧是否溢出
        if (adjustedLeft < padding) {
          adjustedLeft = padding
        }
      } else {
        // 右对齐：检查左侧是否溢出
        const leftEdge = window.innerWidth - adjustedRight - menuRect.width
        if (leftEdge < padding) {
          adjustedRight = window.innerWidth - menuRect.width - padding
        }
        // 检查右侧是否溢出
        if (adjustedRight < padding) {
          adjustedRight = padding
        }
      }

      // 应用调整后的位置
      menuRef.current.style.top = `${adjustedTop}px`
      if (align === 'left') {
        menuRef.current.style.left = `${adjustedLeft}px`
        menuRef.current.style.right = 'auto'
      } else {
        menuRef.current.style.right = `${adjustedRight}px`
        menuRef.current.style.left = 'auto'
      }
    }
  }, [isOpen, menuPosition, align])

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node) &&
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // 按 Escape 关闭；焦点在菜单里时交还给触发按钮，避免随菜单一起消失
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (menuRef.current?.contains(document.activeElement)) {
        triggerRef.current?.querySelector<HTMLElement>('button, a[href], [tabindex]')?.focus()
      }
      setIsOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  return (
    <>
      <div ref={triggerRef} onClick={() => setIsOpen(!isOpen)}>
        {trigger}
      </div>

      {isOpen &&
        createPortal(
          <DropdownMenuPanel
            panelRef={menuRef}
            items={items}
            onClose={() => setIsOpen(false)}
            style={{
              top: `${menuPosition.top}px`,
              left: align === 'left' ? `${menuPosition.left}px` : 'auto',
              right: align === 'right' ? `${menuPosition.right}px` : 'auto',
              zIndex: Z_INDEX.DROPDOWN,
              backgroundColor: 'var(--card)',
              borderColor: 'var(--border)',
            }}
          />,
          document.body
        )}
    </>
  )
}

interface DropdownMenuPanelProps {
  items: MenuItem[]
  /** 点击可用的菜单项后调用 */
  onClose: () => void
  style?: React.CSSProperties
  panelRef?: React.Ref<HTMLDivElement>
}

/** 菜单面板本身。与定位、开合逻辑分开，不依赖浏览器环境，便于单独渲染和测试。 */
export function DropdownMenuPanel({ items, onClose, style, panelRef }: DropdownMenuPanelProps) {
  return (
    <div
      ref={panelRef}
      role="menu"
      className="vibehub-popover fixed w-56 rounded shadow-2xl border py-1"
      style={style}
    >
      {items.map((item, index) => (
        <div key={index} role="none">
          {item.divider && index > 0 && <div role="separator" className="my-1 h-px bg-border" />}
          <button
            type="button"
            role={item.selected === undefined ? 'menuitem' : 'menuitemradio'}
            aria-checked={item.selected}
            onClick={() => {
              if (!item.disabled) {
                item.onClick()
                onClose()
              }
            }}
            disabled={item.disabled}
            className={`w-full flex items-center gap-3 px-4 py-2 text-sm text-left transition-colors ${
              item.danger
                ? 'text-destructive hover:bg-destructive/10'
                : item.selected
                  ? 'text-primary hover:bg-muted'
                  : 'text-foreground hover:bg-muted'
            } ${item.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            {item.icon && <span className="flex-shrink-0">{item.icon}</span>}
            <span className="flex-1">{item.label}</span>
            {item.selected && <Check className="w-4 h-4 flex-shrink-0" aria-hidden="true" />}
          </button>
        </div>
      ))}
    </div>
  )
}
