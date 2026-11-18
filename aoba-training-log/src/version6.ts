import type { TrainingSheet } from './excelPlan'
import type { RoutineItem, Unit } from './model'
import { weekdays } from './routines'

export function version6Items(sheet: TrainingSheet): RoutineItem[] {
  const cells = new Map(sheet.rows.flatMap(row => row.cells.map(cell => [cell.address, cell])))
  const merges = new Set(sheet.merges)
  const normalized = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim()
  const cell = (address: string) => {
    const value = cells.get(address)
    if (value?.formula) throw new Error(address + 'は数式のため、確定できません。')
    return value
  }
  const text = (address: string) => normalized(cell(address)?.text ?? '')
  const requireText = (address: string, pattern: RegExp) => {
    const value = text(address)
    if (!pattern.test(value)) throw new Error(address + 'の内容が対応するversion6形式と異なります。')
    return value
  }
  for (const [index, day] of weekdays.entries()) requireText(String.fromCharCode(66 + index) + '2', new RegExp('^' + day + '$'))
  requireText('A1', /\bversion\s*6$/i)
  for (const range of ['A1:H1', 'B3:H3', 'B4:H4', 'B5:H5', 'C15:G15', 'A18:A24']) {
    if (!merges.has(range)) throw new Error('結合セル ' + range + ' を確認できません。')
  }
  const daily = [] as number[]
  const days = (row: number) => weekdays.flatMap((_, index) => text(String.fromCharCode(66 + index) + row) ? [index] : [])
  function uniform(row: number, pattern: RegExp) {
    const selected = days(row)
    const first = selected[0]
    if (first === undefined) throw new Error('行 ' + row + ' に実施曜日がありません。')
    const value = requireText(String.fromCharCode(66 + first) + row, pattern)
    if (selected.some(day => text(String.fromCharCode(66 + day) + row) !== value)) throw new Error('行 ' + row + ' の曜日ごとに目標が異なります。')
    return value
  }
  function item(id: string, name: string, schedule: RoutineItem['schedule'], selected: number[],
    target?: { amount: number; unit: Unit }, options: { condition?: string; group?: string; note?: string } = {}): RoutineItem {
    return { id: 'v6-' + id, name, schedule, weekdays: selected, mode: target ? 'quantity' : 'check',
      recordUnit: target?.unit, target, note: options.note ?? '', condition: options.condition ?? '', group: options.group }
  }
  requireText('B3', /^毎日$/)
  requireText('B4', /^気がついた時$/)
  const balance = Number(requireText('B5', /^毎日(\d+)分 左右$/).match(/\d+/)![0])
  uniform(6, /^[◯○]$/)
  uniform(7, /^[◯○]$/)
  requireText('A7', /^筋トレ$/)
  const rope = uniform(8, /^\d+分$/)
  for (const day of days(8)) {
    const address = String.fromCharCode(66 + day) + '8'
    if (cell(address)?.format !== '[m]"分"') throw new Error(address + 'の時間の表示形式を確認してください。')
  }
  const setTarget = (value: string) => {
    const match = /^(?:各)?(\d+)回×(\d+)セット$/.exec(value)!
    return { reps: match[1], amount: Number(match[2]), unit: 'セット' as const }
  }
  const lunge = setTarget(uniform(9, /^\d+回×\d+セット$/))
  const throwSet = setTarget(uniform(10, /^各\d+回×\d+セット$/))
  requireText('A10', /^メディシンボール 横スロー\(左右\)&上スロー$/)
  const swing = Number(uniform(11, /^\d+$/))
  if (days(12).length) throw new Error('早振りの曜日・数量欄が空欄ではありません。')
  const frontTee = uniform(13, /^いい感覚が掴めるまで$/)
  const tee = Number(uniform(14, /^\d+$/))
  const ground = requireText('C15', /^部活がない日 \d+回逆シングル&\d+普通$/).match(/\d+/g)!.map(Number)
  requireText('A18', /^筋トレメニュー$/)
  const strength = [18, 19, 20, 21, 22, 23].map(row => {
    const name = requireText('B' + row, /\S/)
    const reps = requireText('C' + row, /^\d+(?:回|往復)(?:×\d+セット)?$/)
    const set = /^(\d+回)×(\d+)セット$/.exec(reps)
    return item('strength-' + row, name.replace(/ +3kg$/, '3kg') + (set ? set[1] : reps), 'weekdays', days(7),
      set ? { amount: Number(set[2]), unit: 'セット' } : undefined, { group: '筋トレ' })
  })
  return [
    item('stretch', text('A3').replaceAll('&', '＆'), 'daily', daily),
    item('frog', text('A4'), 'conditional', [], undefined, { condition: text('B4') }),
    ...['左', '右'].map(side => item('balance-' + side, text('A5') + '（' + side + '）', 'daily', daily,
      { amount: balance, unit: '分' }, { group: '軸足バランス' })),
    item('vision', text('A6'), 'weekdays', days(6)),
    ...strength,
    item('rope', '縄跳び', 'weekdays', days(8), { amount: Number(rope.replace('分', '')), unit: '分' },
      { note: text('A8').slice('縄跳び'.length).trim() }),
    item('lunge', text('A9') + lunge.reps + '回', 'weekdays', days(9), { amount: lunge.amount, unit: lunge.unit }),
    ...['横スロー（左）', '横スロー（右）', '上スロー'].map((name, i) =>
      item('medicine-' + i, name + throwSet.reps + '回', 'weekdays', days(10),
        { amount: throwSet.amount, unit: throwSet.unit }, { group: 'メディシンボール' })),
    item('swing', text('A11'), 'weekdays', days(11), { amount: swing, unit: '回' }),
    item('fast-swing', text('A12'), 'conditional', []),
    item('front-tee', text('A13'), 'weekdays', days(13), undefined, { condition: frontTee }),
    item('tee', text('A14'), 'weekdays', days(14), { amount: tee, unit: '回' }),
    ...['逆シングル', '通常'].map((name, i) => item('ground-' + i, name, 'conditional', [],
      { amount: ground[i], unit: '回' }, { group: '手ゴロ', condition: '部活がない日' })),
  ]
}
