import { useState, type ChangeEvent, type FormEvent } from 'react'
import { importCandidates, readTrainingSheet, type ColumnMap } from './excelPlan'
import type { Menu, RoutineItem } from './model'
import { RoutineFields } from './RoutineFields'
import { findRoutineMenu } from './routines'

const labels: [keyof ColumnMap, string][] = [['name', '種目名'], ['schedule', '曜日・条件'], ['target', '数量・単位'], ['note', '補足・親メニュー']]
type Candidate = { item: RoutineItem; selected: boolean; unresolved: boolean }

export function ExcelImport({ menus, useItems, close, backup }: {
  menus: Menu[]; useItems: (items: RoutineItem[], sourceKey: string) => void; close: () => void; backup: () => void
}) {
  const [sheet, setSheet] = useState<Awaited<ReturnType<typeof readTrainingSheet>>>()
  const [map, setMap] = useState<ColumnMap>({ name: '', schedule: '', target: '', note: '' })
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [preview, setPreview] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const matrix = Boolean(sheet?.version6)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setLoading(true)
    setError('')
    setPreview(false)
    setConfirmed(false)
    setSheet(undefined)
    setMap({ name: '', schedule: '', target: '', note: '' })
    try {
      const next = await readTrainingSheet(file)
      setSheet(next)
      setFirst(String(next.rows[0].number))
      setLast(String(next.rows.at(-1)!.number))
      if (next.version6) {
        setCandidates(next.version6.map(item => ({ item, selected: true, unresolved: false })))
        setPreview(true)
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'ファイルを確認できませんでした。')
    } finally {
      setLoading(false)
    }
  }

  function makePreview(event: FormEvent) {
    event.preventDefault()
    if (!sheet) return
    setError('')
    if (Number(first) > Number(last) || Number(first) < 1) { setError('対象行の範囲を確認してください。'); return }
    const results = importCandidates(sheet, map, menus, Number(first), Number(last))
    if (!results.length) { setError('取り込み候補がありません。種目名の列と行を確認してください。'); return }
    setConfirmed(false)
    setCandidates(results.map(({ item, unresolved }) => ({ item, unresolved, selected: false, checked: false })))
    setPreview(true)
  }

  const selected = candidates.filter(candidate => candidate.selected)
  function edit(index: number, update: Partial<Candidate>) {
    setConfirmed(false)
    setCandidates(current => current.map((row, i) => i === index ? { ...row, ...update } : row))
  }

  const groups = new Map<string, { candidate: Candidate; index: number }[]>()
  const rows = candidates.map((candidate, index) => ({ candidate, index }))
  for (const row of rows) {
    const group = row.candidate.item.group
    if (group) groups.set(group, [...(groups.get(group) ?? []), row])
  }

  function setAll(value: boolean) {
    setConfirmed(false)
    setCandidates(current => current.map(candidate => ({ ...candidate, selected: value })))
  }

  function entry({ candidate, index }: typeof rows[number]) {
    const { item } = candidate
    const schedule = item.schedule === 'daily' ? '毎日' : item.schedule === 'conditional'
      ? (item.condition || '曜日指定なし') : item.weekdays.map(day => '日月火水木金土'[day]).join('・')
    return <li key={item.id} className="excel-preview-item">
      <label className="excel-preview-select">
        <input type="checkbox" checked={candidate.selected} onChange={event => edit(index, { selected: event.target.checked })} />
        <span><strong>{item.name}</strong>{findRoutineMenu(menus, item)?.enabled === false && <span className="excel-preview-meta">非表示</span>}
          <span className="excel-preview-meta">{schedule} · {item.target ? '目標 ' + item.target.amount + item.target.unit : '数量目標なし'}</span>
          {item.schedule !== 'conditional' && item.condition && <span className="excel-preview-meta">{item.condition}</span>}
          {matrix && item.note && <span className="excel-preview-meta">{item.note}</span>}
          {candidate.unresolved && <span className="excel-preview-meta">要確認</span>}
        </span>
      </label>
      {candidate.selected && !matrix && <RoutineFields item={item} menus={menus} change={item => edit(index, { item })} />}
    </li>
  }

  return <section className="card routine-import">
    <h2>Excel初期取り込み</h2>
    <p className="hint">version6の練習計画は、曜日列と種目の配置から判定します。</p>
    <div className="fields editor">
      <label>Excelファイル<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={chooseFile} disabled={loading} /></label>
      <button className="action" onClick={close}>取り込みをキャンセル</button>
    </div>
    {loading && <p role="status">対象シートを読み込んでいます。</p>}
    {sheet && <>
      <details className="editor" open={!preview}>
        <summary>元のセル値・表示形式を確認</summary>
        <div className="routine-source">{sheet.rows.map(row => <p key={row.number}>
          {row.cells.map(cell => <span key={cell.address}><strong>{cell.address}</strong> {cell.text}
            {(cell.format !== 'General' || cell.formula) &&
              <small>表示形式 {cell.format} · 元値 {cell.raw || '—'}{cell.formula ? ' · 数式（結果は要確認）' : ''}</small>}
          </span>)}
        </p>)}</div>
      </details>
      {!matrix && <form className="editor fields" onSubmit={makePreview}>
        {labels.map(([key, label]) => <label key={key}>{label}の列<select required={key === 'name'} value={map[key]}
          onChange={event => { setMap({ ...map, [key]: event.target.value }); setPreview(false) }}>
          <option value="">指定なし</option>{sheet.columns.map(name => <option key={name}>{name}</option>)}
        </select></label>)}
        <div className="routine-range">
          <label>開始行<input type="number" min="1" step="1" required value={first} onChange={event => { setFirst(event.target.value); setPreview(false) }} /></label>
          <label>終了行<input type="number" min="1" step="1" required value={last} onChange={event => { setLast(event.target.value); setPreview(false) }} /></label>
        </div>
        <button className="action filled" type="submit">取り込み候補を確認</button>
      </form>}
    </>}
    {preview && sheet && <div className="editor excel-preview">
      <h3 aria-live="polite">取り込み予定：{selected.length}種目 <span className="hint">／ 全{candidates.length}種目</span></h3>
      <p className="hint">チェックを入れた種目だけを取り込みます。確定前にJSONバックアップを保存してください。</p>
      <div className="form-actions">
        <button className="action" disabled={selected.length === candidates.length} onClick={() => setAll(true)}>すべて選択</button>
        <button className="action" disabled={!selected.length} onClick={() => setAll(false)}>すべて解除</button>
        <button className="action" onClick={backup}>JSONバックアップを保存</button>
      </div>
      <ul className="excel-preview-list">{rows.map(row => {
        const group = row.candidate.item.group
        if (!group) return entry(row)
        const members = groups.get(group)!
        if (members[0].index !== row.index) return null
        return <li key={'group-' + group} className="excel-preview-group">
          <details open>
            <summary><strong>{group}</strong> <span>選択 {members.filter(member => member.candidate.selected).length}／{members.length}種目</span></summary>
            <ul>{members.map(entry)}</ul>
          </details>
        </li>
      })}</ul>
      <label className="routine-check excel-preview-confirm"><input type="checkbox" checked={confirmed} disabled={!selected.length}
        onChange={event => setConfirmed(event.target.checked)} />選択した{selected.length}種目の曜日・条件・目標を確認しました</label>
      <p className="hint">次の画面で適用開始日と内容を確認して保存します。</p>
      <div className="form-actions">
        <button className="action filled" disabled={!selected.length || !confirmed}
          onClick={() => useItems(selected.map(item => item.item), sheet.sourceKey)}>取り込みを確定</button>
        <button className="action" onClick={close}>キャンセル</button>
      </div>
    </div>}
    {error && <p role="alert" className="error">{error}</p>}
  </section>
}





