import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import { CloudAccount } from './CloudAccount'
import { initialData } from './initialData'
import type { TrainingData } from './model'
import { deleteMenu } from './training'
import type { SyncView } from './useTrainingStorage'

vi.mock('./cloud', () => ({ supabase: null, config: null }))

const today = '2026-11-19'
const base = initialData()
const archived = deleteMenu(base, base.menus[0], today)
const following = '<tr><th scope="row">条件付き計画の追加</th><td>1件</td><td>0件</td></tr>'
  + '<tr><th scope="row">計画の完了チェック</th><td>0件</td><td>1件</td></tr>'

function render(local: TrainingData, cloud?: TrainingData) {
  const sync: SyncView = {
    status: 'データ競合', choosing: false, choiceError: '', lastSynced: undefined, archives: [],
    decision: { kind: 'conflict', local, source: 'account', remote: cloud ? { data: cloud, revision: 2 } : null, version: 1 },
    choose: vi.fn(), retry: vi.fn(),
  }
  return renderToStaticMarkup(<CloudAccount session={null} back={vi.fn()} sync={sync} />)
}

test.each([
  [base, base, undefined],
  [archived, base, ['1件', '0件']],
  [base, archived, ['0件', '1件']],
  [archived, archived, ['1件', '1件']],
] as const)('競合画面で削除済みメニューの有無を揃えて比較する（ケース %#）', (local, cloud, counts) => {
  const html = render(
    { ...local, routineAdditions: [{ date: today, itemId: 'local' }] },
    { ...cloud, routineCompletions: [{ date: today, itemId: 'cloud' }] },
  )
  expect(html).toContain(following)
  if (counts) {
    expect(html).toContain(
      '<tr><th scope="row">削除済みメニュー（履歴用）</th><td>' + counts[0] + '</td><td>' + counts[1] + '</td></tr>' + following,
    )
  } else {
    expect(html).not.toContain('削除済みメニュー（履歴用）')
  }
})

test('クラウドスナップショットがない場合は比較欄にダッシュを表示する', () => {
  expect(render(archived)).toContain('<tr><th scope="row">削除済みメニュー（履歴用）</th><td>1件</td><td>—</td></tr>')
})
