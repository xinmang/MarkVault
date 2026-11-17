import type { ComponentType } from 'react'
import type { PluginTagLayout, PluginViewMode } from '@/lib/constants/bookmarks'
import { BookmarkGalleryView } from '../view-gallery/BookmarkGalleryView'
import { BookmarkTimelineView } from '../view-timeline/BookmarkTimelineView'
import { BookmarkDomainsView } from '../view-domains/BookmarkDomainsView'
import { BookmarkFocusView } from '../view-focus/BookmarkFocusView'
import { TagCloud } from '../tag-cloud/TagCloud'
import { TagBars } from '../tag-bars/TagBars'
import type { BookmarkLayoutViewProps } from './shared'
import type { TagLayoutProps } from './TagButton'

/** 布局名到实现的对应表；宿主只按名字取用，新增布局插件时在这里登记。 */
export const BOOKMARK_LAYOUT_VIEWS: Record<PluginViewMode, ComponentType<BookmarkLayoutViewProps>> = {
  gallery: BookmarkGalleryView,
  timeline: BookmarkTimelineView,
  domains: BookmarkDomainsView,
  focus: BookmarkFocusView,
}

export const TAG_LAYOUT_VIEWS: Record<PluginTagLayout, ComponentType<TagLayoutProps>> = {
  cloud: TagCloud,
  bars: TagBars,
}
