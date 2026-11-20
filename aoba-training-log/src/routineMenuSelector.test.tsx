import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import { initialData } from './initialData'
import { RoutineFields } from './RoutineFields'
import type { RoutineDraftItem } from './routines'

const menus = initialData().menus
const draft: RoutineDraftItem = {
  id: 'item', name: '素振り', schedule: 'daily', weekdays: [], note: '', condition: '',
}

test('新規計画では既存の5分類を順番どおり閉じ、分類内のメニュー順も維持する', () => {
  const change = vi.fn()
  const html = renderToStaticMarkup(<RoutineFields item={draft} menus={menus} change={change} />)
  const groups = [...html.matchAll(/<details class="menu-group"><summary><span>([^<]+)/g)]
  expect(groups.map(match => match[1])).toEqual(['打撃', '守備', '走塁', '体づくり', 'その他'])
  expect(html).toMatch(/素振り（回）[\s\S]*ティーバッティング（球）[\s\S]*トスバッティング（球）/)
  expect(html).toContain('選択中：なし')
  expect(change).not.toHaveBeenCalled()
})

test('閉じた分類の中でも既存の非表示メニューと数量目標を表示する', () => {
  const item: RoutineDraftItem = { ...draft, menuId: 'swing', mode: 'quantity', recordUnit: '回', target: { amount: 20, unit: '回' } }
  const hidden = menus.map(menu => menu.id === 'swing' ? { ...menu, enabled: false } : menu)
  const html = renderToStaticMarkup(<RoutineFields item={item} menus={hidden} change={vi.fn()} />)
  expect(html).toContain('選択中：素振り（回） · 非表示')
  expect(html).toContain('<span>打撃</span><span>3種目 · 選択中</span>')
  expect(html).toContain('aria-pressed="true"')
  expect(html).toContain('value="20"')
})

test('単位が一致しない既存の紐づけは、候補の選び直しを案内する', () => {
  const item: RoutineDraftItem = { ...draft, menuId: 'swing', mode: 'quantity', recordUnit: '分' }
  const change = vi.fn()
  const html = renderToStaticMarkup(<RoutineFields item={item} menus={menus} change={change} />)
  expect(html).toContain('選択中：選び直してください')
  expect(html).toContain('disabled="" aria-pressed="false">計画の表示のみ')
  expect(change).not.toHaveBeenCalled()
})
