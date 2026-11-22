import { useState, type FormEvent } from 'react'
import { moveCategory, saveCategory, type CategorySettings, type MenuCategory } from './menuCategories'

type ChangeCategories = (edit: (latest: CategorySettings) => CategorySettings) => boolean

function CategoryRow({ category, index, total, change }: {
  category: MenuCategory; index: number; total: number; change: ChangeCategories
}) {
  const [draft, setDraft] = useState<string>()
  const { id, name } = category
  function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (draft !== undefined && change(latest => saveCategory(latest, draft, id))) setDraft(undefined)
  }
  return <li>
    <strong>{name}</strong>
    <div className="form-actions">
      <button type="button" className="action" aria-label={name + 'の名称を変更'}
        onClick={() => setDraft(name)}>名称変更</button>
      <button type="button" className="action" aria-label={name + 'を上へ移動'}
        aria-disabled={index === 0} onClick={() => change(latest => moveCategory(latest, id, -1))}>上へ</button>
      <button type="button" className="action" aria-label={name + 'を下へ移動'}
        aria-disabled={index === total - 1} onClick={() => change(latest => moveCategory(latest, id, 1))}>下へ</button>
    </div>
    {draft !== undefined && <form className="fields editor" onSubmit={rename}>
      <label>新しい分類名<input autoFocus required value={draft} onChange={event => setDraft(event.target.value)} /></label>
      <div className="form-actions">
        <button type="submit" className="action filled">分類名を保存</button>
        <button type="button" className="action" onClick={() => setDraft(undefined)}>キャンセル</button>
      </div>
    </form>}
  </li>
}

export function CategoryManagement({ settings, change }: { settings: CategorySettings; change: ChangeCategories }) {
  const [name, setName] = useState('')
  return <details className="category-management">
    <summary>分類を管理</summary>
    <p className="hint">分類名・順番・メニューの所属はこのブラウザーに保存されます。他の端末とは同期されません。</p>
    <ol className="entries">
      {settings.categories.map((category, index) => <CategoryRow key={category.id} category={category}
        index={index} total={settings.categories.length} change={change} />)}
    </ol>
    <form className="fields editor" onSubmit={event => {
      event.preventDefault()
      if (change(latest => saveCategory(latest, name))) setName('')
    }}>
      <label>追加する分類名<input required value={name} onChange={event => setName(event.target.value)} /></label>
      <button type="submit" className="action filled">分類を追加</button>
    </form>
  </details>
}
