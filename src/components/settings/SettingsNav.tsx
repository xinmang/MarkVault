import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export interface SettingsNavItem {
  id: string
  label: string
  icon: LucideIcon
}
export interface SettingsNavGroup {
  label: string
  items: SettingsNavItem[]
}
interface SettingsNavProps {
  groups: SettingsNavGroup[]
  activeSection: string
  onSectionChange: (sectionId: string) => void
  children: ReactNode
}

export function SettingsNav({
  groups,
  activeSection,
  onSectionChange,
  children,
}: SettingsNavProps) {
  const { t } = useTranslation('settings')
  return (
    <div className="settings-layout flex flex-col gap-5 lg:flex-row lg:gap-8">
      <div className="settings-mobile-nav lg:hidden">
        <label htmlFor="settings-section" className="sr-only">
          {t('navigation')}
        </label>
        <select
          id="settings-section"
          className="settings-mobile-trigger input min-h-11 w-full"
          value={activeSection}
          onChange={(event) => onSectionChange(event.target.value)}
        >
          {groups.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <nav className="settings-sidebar hidden w-52 shrink-0 lg:block" aria-label={t('navigation')}>
        {/* 吸顶页头高 5rem，侧栏停在其下方 */}
        <div className="sticky top-24 space-y-6">
          {groups.map((group) => (
            <div key={group.label}>
              <div className="mb-2 px-3 text-xs font-medium text-muted-foreground">
                {group.label}
              </div>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon
                  const active = activeSection === item.id
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSectionChange(item.id)}
                      aria-current={active ? 'page' : undefined}
                      className={
                        'settings-nav-item flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-primary ' +
                        (active
                          ? 'settings-nav-item--active bg-primary/10 font-medium text-primary'
                          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground')
                      }
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{item.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>
      <div className="settings-content min-w-0 flex-1">{children}</div>
    </div>
  )
}
