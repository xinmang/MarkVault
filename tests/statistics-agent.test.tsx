import { beforeAll, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import type { AgentAnalyticsResponse } from '../shared/agent-usage-types'
import { AgentUsageDashboard } from '../src/pages/statistics/components/AgentUsageDashboard'
import zh from '../src/i18n/locales/zh-CN/statistics.json'
import en from '../src/i18n/locales/en/statistics.json'

const i18n = createInstance()
beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'zh-CN',
    resources: { 'zh-CN': { statistics: zh }, en: { statistics: en } },
    interpolation: { escapeValue: false },
  })
})

const metrics = {
  calls: 0,
  successful_calls: 0,
  failed_calls: 0,
  success_rate: null,
  avg_duration_ms: null,
}
const empty: AgentAnalyticsResponse = {
  range: {
    start_date: '2026-11-01',
    end_date: '2026-11-03',
    tz: 'Asia/Shanghai',
    granularity: 'day',
    days: 3,
    all_time: false,
  },
  first_event_date: null,
  summary: { ...metrics, tool_calls: 0, active_days: 0 },
  sources: ['chat', 'agent_api', 'mcp'].map((source) => ({
    ...metrics,
    source: source as 'chat' | 'agent_api' | 'mcp',
  })),
  trend: [
    {
      bucket: '2026-11-01',
      start_date: '2026-11-01',
      end_date: '2026-11-01',
      chat: 0,
      agent_api: 0,
      mcp: 0,
    },
  ],
  top_operations: [],
}

function render(data: AgentAnalyticsResponse | undefined, isError = false) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <AgentUsageDashboard
        data={data}
        isLoading={!data && !isError}
        isFetching={false}
        isError={isError}
        locale={i18n.language}
        onRetry={() => undefined}
        onDrillDown={() => undefined}
      />
    </I18nextProvider>
  )
}

describe('Agent 使用统计展示', () => {
  it('空数据保留来源入口与说明，成功率和耗时不伪造为零', () => {
    const html = render(empty)
    expect(html).toContain(zh.agent.empty)
    expect(html).toContain(zh.agent.historyHint)
    expect(html).toContain('成功率 —')
    expect(html).not.toContain('0%')
    expect(html).not.toContain('NaN')
    expect(html).not.toContain('<svg')
  })

  it('展示真实失败数、工具排行和可键盘访问的趋势', () => {
    const populated: AgentAnalyticsResponse = {
      ...empty,
      summary: {
        calls: 2,
        successful_calls: 1,
        failed_calls: 1,
        success_rate: 50,
        avg_duration_ms: 125.5,
        tool_calls: 2,
        active_days: 1,
      },
      trend: [{ ...empty.trend[0]!, mcp: 2 }],
      top_operations: [
        {
          source: 'mcp',
          operation: 'markvault_list_bookmarks',
          calls: 2,
          successful_calls: 1,
          failed_calls: 1,
          success_rate: 50,
          avg_duration_ms: 125.5,
        },
      ],
    }
    const html = render(populated)
    expect(html).toContain('50%')
    expect(html).toContain('125.5 毫秒')
    expect(html).toContain('markvault_list_bookmarks')
    expect(html).toContain('MCP 2')
    expect(html).toContain('tabindex="0" role="button"')
    expect(html).not.toContain('NaN')
  })

  it('首次失败可以重试，刷新失败明确标记旧数据', () => {
    expect(render(undefined, true)).toContain(zh.page.loadFailed)
    expect(render(undefined, true)).toContain('role="alert"')
    expect(render(empty, true)).toContain(zh.agent.refreshFailed)
  })

  it('英文文案覆盖新视图的全部字段', async () => {
    await i18n.changeLanguage('en')
    try {
      const html = render(empty)
      expect(html).toContain(en.agent.empty)
      expect(html).toContain(en.agent.historyHint)
      expect(Object.keys(en.agent).sort()).toEqual(Object.keys(zh.agent).sort())
    } finally {
      await i18n.changeLanguage('zh-CN')
    }
  })
})
