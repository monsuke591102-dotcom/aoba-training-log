import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import { QuickRecords } from './QuickRecords'
import { decodeBackup, encodeBackup } from './backup'
import { initialData } from './initialData'
import type { Menu, RoutineItem, TrainingData } from './model'
import { saveQuickRecord } from './quickRecord'
import { saveRoutine } from './routines'
import { saveMenu } from './training'

test('軸足バランスの右・左を登録名で表示し、計画と実施済み記録に保存された旧名を保持する', () => {
  const date = '2026-11-20'
  const now = new Date(2026, 10, 20, 12)
  const group = '軸足バランス'
  const menus: Menu[] = ['右', '左'].map((side, index) => ({
    id: 'balance-' + index, name: group + ' · ' + group + '(' + side + ')', unit: '分', category: '体づくり', enabled: true,
  }))
  const items: RoutineItem[] = menus.map((menu, index) => ({
    id: 'balance-plan-' + index, menuId: menu.id, name: group + '（' + (index === 0 ? '右' : '左') + '）',
    group, schedule: 'daily', weekdays: [], note: '', condition: '',
  }))
  let data = saveRoutine({ ...initialData(), menus }, { id: 'balance-plan', startsOn: date, items }, now)
  data = saveQuickRecord(data, date, menus[0].id, '分', '自主練', { delta: 1 }, now)
  const changed = menus.reduce((state, menu) => saveMenu(state, {
    ...menu, name: menu.name.replace(group + ' · ', ''),
  }, '', now), data)
  const render = (state: TrainingData) => renderToStaticMarkup(<QuickRecords data={state} date={date} kind="自主練" commit={vi.fn()} />)
  const restored = decodeBackup(encodeBackup(changed, now)).data

  for (const state of [changed, restored]) {
    const html = render(state)
    expect(html).toContain('<strong>軸足バランス(右)</strong>')
    expect(html).toContain('<strong>軸足バランス(左)</strong>')
    expect(html).not.toContain('軸足バランス · 軸足バランス')
    expect(html).toContain('aria-label="軸足バランス(右)を増やす"')
    expect(html).toContain('aria-label="軸足バランス(左)を増やす"')
    expect(state.routineVersions).toEqual(data.routineVersions)
    expect(state.records[0]).toMatchObject({ menuId: menus[0].id, menuName: menus[0].name, amount: 1 })
  }
})
