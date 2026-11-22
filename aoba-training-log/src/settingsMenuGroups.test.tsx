import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import { initialData } from './initialData'
import type { Menu, TrainingData } from './model'
import { Settings } from './Settings'

function renderSettings(data: TrainingData) {
  const commit = vi.fn()
  const html = renderToStaticMarkup(<Settings data={data} commit={commit}
    onDataManagement={vi.fn()} onCloudAccount={vi.fn()} onPlanManagement={vi.fn()} />)
  expect(commit).not.toHaveBeenCalled()
  return html
}

test('固定の分類順で全分類を閉じ、非表示メニューを件数に含める', () => {
  const data = initialData()
  const menus = data.menus.map(menu => menu.id === 'swing' ? { ...menu, enabled: false } : menu)
  const html = renderSettings({ ...data, menus })
  const groups = [...html.matchAll(/<details class="menu-group" data-menu-category="([^"]+)" data-category-id="[^"]*"><summary>.*?<span>(\d+)種目/g)]
  expect(groups.map(match => [match[1], Number(match[2])])).toEqual([
    ['打撃', 3], ['守備', 5], ['走塁', 3], ['体づくり', 4], ['その他', 3],
  ])
  expect(html).toContain('aria-label="素振りを再表示"')
  expect(html.match(/class="menu-category-icon" aria-hidden="true"/g)).toHaveLength(5)
  for (const [, category] of groups) {
    expect(html).toContain(`aria-label="${category}にメニュー追加"`)
  }
})

test('欠落・未知の分類値を持つ種目だけを末尾の未分類に表示する', () => {
  const data = initialData()
  const menus = [
    ...data.menus,
    { ...data.menus[0], id: 'missing', name: '分類値なし', category: undefined },
    { ...data.menus[0], id: 'unknown', name: '未知の分類値', category: '旧分類', enabled: false },
  ] as Menu[]
  const html = renderSettings({ ...data, menus })
  const groups = [...html.matchAll(/data-menu-category="([^"]+)"/g)]
  expect(groups.at(-1)?.[1]).toBe('未分類')
  expect(html).toContain('<span class="menu-category-label">未分類</span><span>2種目</span>')
  expect(html).not.toContain('未分類にメニュー追加')
  expect(html).toContain('aria-label="分類値なしを編集"')
  expect(html).toContain('aria-label="未知の分類値を再表示"')
  expect(menus.slice(-2).map(menu => menu.category)).toEqual([undefined, '旧分類'])
})
