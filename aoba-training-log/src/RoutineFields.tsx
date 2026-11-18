import { useState } from 'react'
import { units } from './initialData'
import type { Menu, RoutineItem } from './model'
import { weekdays } from './routines'

export function RoutineFields({ item, menus, change }: { item: RoutineItem; menus: Menu[]; change: (item: RoutineItem) => void }) {
  const menu = menus.find(menu => menu.id === item.menuId)
  const unit = item.recordUnit ?? menu?.unit
  const mode = item.mode ?? (menu ? 'quantity' : 'display')
  return <fieldset className="fields">
    <label>種目名<input value={item.name} onChange={event => change({ ...item, name: event.target.value })} /></label>
    <label>記録メニュー<select value={item.menuId ?? ''} onChange={event => {
      const next = menus.find(menu => menu.id === event.target.value)
      change({ ...item, menuId: next?.id, recordUnit: next?.unit, mode: next ? 'quantity' : undefined, name: item.name || next?.name || '', target: undefined })
    }}>
      <option value="">計画の表示のみ</option>
      {menus.map(menu => <option key={menu.id} value={menu.id}>{menu.name}（{menu.unit}）</option>)}
    </select></label>
    <label>記録方法<select value={mode} onChange={event => {
      const value = event.target.value
      change({ ...item, menuId: undefined, target: undefined, mode: value === 'display' ? undefined : value as 'check' | 'quantity',
        recordUnit: value === 'quantity' ? unit : undefined })
    }}><option value="display">計画の表示のみ</option><option value="quantity">数量</option><option value="check">完了チェック</option></select></label>
    {mode === 'quantity' && <label>記録単位<select value={unit ?? ''} onChange={event => {
      const value = (event.target.value || undefined) as Menu['unit'] | undefined
      change({ ...item, menuId: undefined, recordUnit: value, target: undefined })
    }}><option value="">単位を選ぶ</option>{units.map(value => <option key={value}>{value}</option>)}</select></label>}
    <label>所属グループ<input value={item.group ?? ''} onChange={event => change({ ...item, group: event.target.value })} /></label>
    <label>実施区分<select value={item.schedule} onChange={event => change({ ...item, schedule: event.target.value as RoutineItem['schedule'] })}>
      <option value="weekdays">曜日別</option><option value="daily">毎日</option><option value="conditional">条件付き・任意</option>
    </select></label>
    {item.schedule === 'weekdays' && <fieldset className="routine-weekdays"><legend>実施曜日</legend>
      {[1, 2, 3, 4, 5, 6, 0].map(day => <label className="checkbox" key={day}>
        <input type="checkbox" checked={item.weekdays.includes(day)} onChange={event => change({ ...item,
          weekdays: event.target.checked ? [...item.weekdays, day] : item.weekdays.filter(value => value !== day),
        })} />{weekdays[day]}
      </label>)}
    </fieldset>}
    {mode === 'quantity' && unit && <label>目標数量（{unit}・任意）<input type="number" value={item.target?.amount ?? ''} onChange={event => {
      const value = event.target.value
      change({ ...item, target: value ? { amount: Number(value), unit } : undefined })
    }} /></label>}
    <label>実施条件<input value={item.condition} onChange={event => change({ ...item, condition: event.target.value })} /></label>
    {item.note && <p className="hint">{item.note}</p>}
  </fieldset>
}

export function NewPlanMenu({ add }: { add: (menu: Omit<Menu, 'id'>) => void }) {
  const [name, setName] = useState('')
  const [unit, setUnit] = useState<Menu['unit']>('回')
  return <div className="fields">
    <label>新しい記録メニュー名<input value={name} onChange={event => setName(event.target.value)} /></label>
    <label>単位<select value={unit} onChange={event => setUnit(event.target.value as Menu['unit'])}>{units.map(value => <option key={value}>{value}</option>)}</select></label>
    <button type="button" className="action" disabled={!name.trim()} onClick={() => { add({ name: name.trim(), unit, category: 'その他', enabled: true }); setName('') }}>記録メニューを候補に追加</button>
  </div>
}

