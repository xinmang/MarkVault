import type { ComponentType } from 'react'
import {
  Columns3,
  History,
  Infinity as InfinityIcon,
  LayoutDashboard,
  LayoutPanelLeft,
  PanelTop,
  PanelsTopLeft,
  Rocket,
  SquareKanban,
  type LucideIcon,
} from 'lucide-react'
import type { PluginHomeShell, PluginTabShell, ShellPage } from '@/plugins/shells'
import { HomeTopbarShell } from '../home-topbar/HomeTopbarShell'
import { HomeLaunchpadShell } from '../home-launchpad/HomeLaunchpadShell'
import { HomeReaderShell } from '../home-reader/HomeReaderShell'
import { HomeTagboardShell } from '../home-tagboard/HomeTagboardShell'
import { TabsTabbedShell } from '../tabs-tabbed/TabsTabbedShell'
import { TabsWallShell } from '../tabs-wall/TabsWallShell'
import { TabsTimelineShell } from '../tabs-timeline/TabsTimelineShell'
import { HomeCanvasShell } from '../home-canvas/HomeCanvasShell'
import { TabsCanvasShell } from '../tabs-canvas/TabsCanvasShell'
import type { HomeShellProps } from './home-shared'
import type { TabShellProps } from './tab-shared'

/** 版式名到实现的对应表；宿主只按名字取用，新增页面版式插件时在这里登记。 */
export const HOME_SHELL_VIEWS: Record<PluginHomeShell, ComponentType<HomeShellProps>> = {
  topbar: HomeTopbarShell,
  launchpad: HomeLaunchpadShell,
  reader: HomeReaderShell,
  tagboard: HomeTagboardShell,
  canvas: HomeCanvasShell,
}

export const TAB_SHELL_VIEWS: Record<PluginTabShell, ComponentType<TabShellProps>> = {
  tabbed: TabsTabbedShell,
  wall: TabsWallShell,
  timeline: TabsTimelineShell,
  canvas: TabsCanvasShell,
}

/** 切换菜单和设置页里代表各版式的图标；default 是不使用插件时的默认骨架。 */
export const SHELL_ICONS: { [Page in ShellPage]: Record<string, LucideIcon> } = {
  home: {
    default: LayoutPanelLeft,
    topbar: PanelTop,
    launchpad: Rocket,
    reader: Columns3,
    tagboard: SquareKanban,
    canvas: InfinityIcon,
  },
  tabs: {
    default: LayoutPanelLeft,
    tabbed: PanelsTopLeft,
    wall: LayoutDashboard,
    timeline: History,
    canvas: InfinityIcon,
  },
}
