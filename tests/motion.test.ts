import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MOTION_PREFERENCES,
  motionDurationScale,
  motionIndexStyle,
  motionRootAttributes,
  motionRootVariables,
  resolveMotionSettings,
} from '../src/lib/motion'

describe('动效设置解析', () => {
  it('缺省时使用迁移中的默认值', () => {
    expect(resolveMotionSettings()).toEqual({
      enabled: true,
      speed: 100,
      intensity: 'standard',
      buttonFeedback: true,
      cardHover: 'lift',
      listEntrance: 'rise',
      tagLinkage: true,
      pageTransition: true,
    })
  })

  it('只读取总开关，旧的单项动效设置统一使用标准值', () => {
    const settings = resolveMotionSettings({
      motion_enabled: 'yes' as unknown as boolean,
      motion_speed: 999,
      motion_intensity: 'wild' as never,
      motion_card_hover: 'spin' as never,
      motion_list_entrance: 'scale',
    })
    expect(settings.enabled).toBe(true)
    expect(settings.speed).toBe(100)
    expect(settings.intensity).toBe('standard')
    expect(settings.cardHover).toBe('lift')
    expect(settings.listEntrance).toBe('rise')
    expect(resolveMotionSettings({ motion_speed: Number.NaN }).speed).toBe(100)
    expect(resolveMotionSettings({ motion_speed: 10 }).speed).toBe(100)
    expect(
      resolveMotionSettings({ motion_enabled: false, motion_tag_linkage: false }).enabled
    ).toBe(false)
  })

  it('速度越快时长越短', () => {
    expect(motionDurationScale(100)).toBe(1)
    expect(motionDurationScale(200)).toBe(0.5)
    expect(motionDurationScale(50)).toBe(2)
    expect(motionDurationScale(Number.NaN)).toBe(1)
    expect(motionRootVariables(resolveMotionSettings({ motion_intensity: 'lively' }))).toEqual({
      '--motion-speed': '1',
      '--motion-scale': '1',
    })
  })
})

describe('写到 <html> 的动效属性', () => {
  it('开启总开关后使用统一动效，不受隐藏的旧单项设置影响', () => {
    const attributes = motionRootAttributes(
      resolveMotionSettings({
        ...DEFAULT_MOTION_PREFERENCES,
        motion_button_feedback: false,
        motion_card_hover: 'glow',
        motion_list_entrance: 'none',
      }),
      false
    )
    expect(attributes).toEqual({
      'data-motion': 'on',
      'data-motion-buttons': 'on',
      'data-motion-card': 'lift',
      'data-motion-entrance': 'rise',
      'data-motion-linkage': 'on',
      'data-motion-page': 'on',
    })
  })

  it('系统要求减少动态效果时关闭动画，但保留静态的标签联动高亮', () => {
    const attributes = motionRootAttributes(resolveMotionSettings(), true)
    expect(attributes['data-motion']).toBe('off')
    expect(attributes['data-motion-card']).toBe('none')
    expect(attributes['data-motion-entrance']).toBe('none')
    expect(attributes['data-motion-buttons']).toBe('off')
    expect(attributes['data-motion-linkage']).toBe('on')
  })

  it('总开关关闭时所有效果都关闭', () => {
    const attributes = motionRootAttributes(resolveMotionSettings({ motion_enabled: false }), false)
    expect(Object.values(attributes).every((value) => value === 'off' || value === 'none')).toBe(
      true
    )
  })

  it('入场错开序号最多 12', () => {
    expect(motionIndexStyle(3)).toEqual({ '--motion-index': 3 })
    expect(motionIndexStyle(99)).toEqual({ '--motion-index': 12 })
    expect(motionIndexStyle(-1)).toEqual({ '--motion-index': 0 })
  })
})
