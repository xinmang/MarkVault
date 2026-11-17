import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Globe } from 'lucide-react'
import { BookmarkUrlText } from '@/components/bookmarks/shared/BookmarkUrlText'
import { domainGroups } from '../layouts/grouping'
import { BookmarkFavicon, BookmarkRow, type BookmarkLayoutViewProps } from '../layouts/shared'

/** 站点分组视图：同一网站的书签收在一个可折叠分组里，书签多的站点排在前面。 */
export function BookmarkDomainsView({ bookmarks, selectedIds = [], ...rest }: BookmarkLayoutViewProps) {
  const { t } = useTranslation('plugins')
  const groups = useMemo(() => domainGroups(bookmarks), [bookmarks])
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const toggle = (host: string) =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (!next.delete(host)) next.add(host)
      return next
    })

  return (
    <div className="layout-domains">
      {groups.map((group) => {
        const open = !collapsed.has(group.host)
        const first = group.items[0]!
        return (
          <section key={group.host} className="layout-domains__group">
            <h3 className="layout-group-heading">
              <button
                type="button"
                className="layout-domains__toggle"
                aria-expanded={open}
                onClick={() => toggle(group.host)}
              >
                <ChevronDown className="layout-chevron" size={16} aria-hidden="true" />
                {group.host ? (
                  <BookmarkFavicon bookmark={first} />
                ) : (
                  <Globe size={16} aria-hidden="true" />
                )}
                {group.host ? <BookmarkUrlText value={group.host} /> : <span>{t('layouts.domains.other')}</span>}
                <span className="layout-group-count">{group.items.length}</span>
              </button>
            </h3>
            {open && (
              <div className="layout-rows">
                {group.items.map((bookmark, index) => (
                  <BookmarkRow
                    key={bookmark.id}
                    view="domains"
                    index={index}
                    bookmark={bookmark}
                    isSelected={selectedIds.includes(bookmark.id)}
                    showHost={!group.host}
                    {...rest}
                  />
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
