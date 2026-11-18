import { unzipSync } from 'fflate'
import type { Menu, RoutineItem } from './model'
import { units } from './initialData'
import { weekdays } from './routines'
import { version6Items } from './version6'

const limit = 8_000_000
type Cell = { address: string; text: string; raw: string; format: string; formula: boolean }
export type SheetRow = { number: number; cells: Cell[] }
export type TrainingSheet = { rows: SheetRow[]; columns: string[]; sourceKey: string; merges?: string[] }
export type ColumnMap = { name: string; schedule: string; target: string; note: string }

const elements = (root: Document | Element, name: string) => Array.from(root.getElementsByTagNameNS('*', name))
const column = (cell: Cell) => cell.address.replace(/\d+$/, '')
const builtInFormats: Record<string, string> = {
  0: 'General', 14: 'm/d/yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM',
  20: 'h:mm', 21: 'h:mm:ss', 22: 'm/d/yy h:mm', 45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mmss.0',
}

function displayTime(raw: string, format: string): string | undefined {
  if (format === '[m]"分"' && /^\d+(?:\.\d+)?$/.test(raw)) {
    const minutes = Number(raw) * 1440
    if (Math.abs(minutes - Math.round(minutes)) < 1e-8) return Math.round(minutes) + '分'
  }
  if (!['h:mm', 'h:mm:ss', '[h]:mm:ss', 'mm:ss'].includes(format) || !/^\d+(?:\.\d+)?$/.test(raw)) return undefined
  const seconds = Math.round(Number(raw) * 86400)
  if (!Number.isSafeInteger(seconds)) return undefined
  const pad = (value: number) => String(value).padStart(2, '0')
  const hours = Math.floor(seconds / 3600)
  const minute = Math.floor(seconds / 60) % 60
  const rest = pad(seconds % 60)
  if (format === 'mm:ss') return pad(minute) + ':' + rest
  const hour = format === '[h]:mm:ss' ? hours : hours % 24
  return hour + ':' + pad(minute) + (format === 'h:mm' ? '' : ':' + rest)
}

export async function readTrainingSheet(file: File): Promise<TrainingSheet & { version6?: RoutineItem[] }> {
  if (!file.name.toLowerCase().endsWith('.xlsx') || file.size > limit) throw new Error('8MB以下の .xlsx ファイルを選んでください。')
  const bytes = new Uint8Array(await file.arrayBuffer())
  function load(names: string[]) {
    let size = 0
    return unzipSync(bytes, { filter: entry => {
      if (!names.includes(entry.name)) return false
      size += entry.originalSize
      if (size > limit) throw new Error('対象シートの展開サイズが大きすぎます。')
      return true
    } })
  }
  function xml(bytes: Uint8Array | undefined) {
    if (!bytes) throw new Error('Excelの構成ファイルが見つかりません。')
    const text = new TextDecoder().decode(bytes)
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('このExcel形式には対応していません。')
    const doc = new DOMParser().parseFromString(text, 'application/xml')
    if (elements(doc, 'parsererror').length) throw new Error('Excelの構成ファイルを読み取れませんでした。')
    return doc
  }
  const index = load(['xl/workbook.xml', 'xl/_rels/workbook.xml.rels'])
  const relations = new Map(elements(xml(index['xl/_rels/workbook.xml.rels']), 'Relationship')
    .filter(node => node.getAttribute('TargetMode') !== 'External')
    .map(node => [node.getAttribute('Id'), node.getAttribute('Target')]))
  const sheets = elements(xml(index['xl/workbook.xml']), 'sheet').flatMap(node => {
    const relation = Array.from(node.attributes).find(attr => attr.localName === 'id')?.value
    const target = relations.get(relation ?? '')
    if (!target) return []
    const path = new URL(target, 'https://workbook.invalid/xl/').pathname.slice(1)
    return /^xl\/worksheets\/[A-Za-z0-9_.-]+\.xml$/.test(path) ? [{ path, name: node.getAttribute('name') ?? '' }] : []
  })
  const parts = load([...sheets.map(sheet => sheet.path), 'xl/styles.xml', 'xl/sharedStrings.xml'])
  const strings = parts['xl/sharedStrings.xml'] ? elements(xml(parts['xl/sharedStrings.xml']), 'si')
    .map(node => elements(node, 't').map(text => text.textContent).join('')) : []
  const styles = parts['xl/styles.xml'] ? xml(parts['xl/styles.xml']) : undefined
  const custom = new Map(styles ? elements(styles, 'numFmt').map(item => [item.getAttribute('numFmtId'), item.getAttribute('formatCode')]) : [])
  const formats = styles ? Array.from(elements(styles, 'cellXfs')[0]?.children ?? []).map(item => item.getAttribute('numFmtId') ?? '0') : []
  function readSheet(path: string) {
    const sheetDoc = xml(parts[path])
    const rows = elements(sheetDoc, 'row').flatMap(row => {
      const number = Number(row.getAttribute('r'))
      const cells = elements(row, 'c').flatMap(cell => {
        const address = cell.getAttribute('r') ?? ''
        if (!/^[A-Z]{1,3}\d+$/.test(address)) return []
        const raw = elements(cell, 'v')[0]?.textContent ?? ''
        const type = cell.getAttribute('t')
        const text = type === 's' ? strings[Number(raw)] ?? '' : type === 'inlineStr'
          ? elements(cell, 't').map(item => item.textContent).join('') : raw
        const formula = elements(cell, 'f').length > 0
        if (!text.trim() && !formula) return []
        const id = formats[Number(cell.getAttribute('s'))] ?? '0'
        const format = custom.get(id) ?? builtInFormats[id] ?? 'Excel形式 #' + id
        return [{ address, text: !type || type === 'n' ? displayTime(raw, format) ?? text : text, raw, format, formula }]
      })
      return cells.length && Number.isInteger(number) && number > 0 ? [{ number, cells }] : []
    })
    const merges = elements(sheetDoc, 'mergeCell').map(cell => cell.getAttribute('ref') ?? '')
    return { rows, merges, columns: Array.from(new Set(rows.flatMap(row => row.cells.map(column)))) }
  }
  const matches: (TrainingSheet & { version6?: RoutineItem[] })[] = []
  let invalid: unknown
  for (const { path, name } of sheets) {
    const candidate = readSheet(path)
    const title = candidate.rows.find(row => row.number === 1)?.cells.find(cell => cell.address === 'A1')?.text ?? ''
    const matrix = candidate.merges.includes('A18:A24') ||
      candidate.rows.some(row => row.number === 2 && row.cells.some(cell => cell.address === 'H2' && cell.text.normalize('NFKC').trim() === '土')) ||
      /version\s*6\s*$/i.test(title.normalize('NFKC'))
    if (!matrix && !name.normalize('NFKC').includes('レギュラー獲得するための練習メニュー')) continue
    try {
      if (!candidate.rows.length || candidate.rows.length > 500) throw new Error('取り込める行がないか、対象シートが500行を超えています。')
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(candidate.rows)))
      const sourceKey = Array.from(new Uint8Array(digest), item => item.toString(16).padStart(2, '0')).join('')
      const sheet = { ...candidate, sourceKey }
      matches.push(matrix ? { ...sheet, version6: version6Items(sheet) } : sheet)
    } catch (error) {
      invalid ??= error
    }
  }
  const matrices = matches.filter(sheet => sheet.version6)
  if (!matrices.length && invalid) throw invalid
  const eligible = matrices.length ? matrices : matches
  if (eligible.length > 1) throw new Error('対応するシートが複数あります。取り込むシートだけを含むファイルを選んでください。')
  if (!eligible.length) throw new Error('対応する練習計画シートが見つかりません。曜日列と種目の配置を確認してください。')
  return eligible[0]
}

export function parseSchedule(raw: string): Pick<RoutineItem, 'schedule' | 'weekdays' | 'condition'> | null {
  const value = raw.trim().normalize('NFKC')
  if (value === '毎日') return { schedule: 'daily', weekdays: [], condition: '' }
  if (/^(気がついた時|気づいた時|部活がない日|任意|必要に応じて)$/.test(value)) {
    return { schedule: 'conditional', weekdays: [], condition: value }
  }
  const tokens = value.split(/[・,、/\s]+/)
  const days = tokens.map(token => /^([日月火水木金土])(?:曜(?:日)?)?$/.exec(token)?.[1])
  if (days.length && days.every(day => day !== undefined)) {
    return { schedule: 'weekdays', weekdays: [...new Set(days.map(day => weekdays.indexOf(day!)))], condition: '' }
  }
  return null
}

export function importCandidates(sheet: TrainingSheet, map: ColumnMap, menus: Menu[], first: number, last: number) {
  return sheet.rows.filter(row => row.number >= first && row.number <= last).flatMap(row => {
    const cell = (letter: string) => row.cells.find(cell => column(cell) === letter)
    const name = cell(map.name)?.text.trim()
    if (!name) return []
    const scheduleCell = cell(map.schedule)
    const targetCell = cell(map.target)
    const scheduled = !scheduleCell?.formula && parseSchedule(scheduleCell?.text ?? '')
    const unitGoal = /^([0-9]+(?:\.[0-9]+)?)\s*(回|分|秒|セット|球|本)$/.exec(targetCell?.text.trim().normalize('NFKC') ?? '')
    const matches = menus.filter(menu => menu.name.normalize('NFKC').trim() === name.normalize('NFKC'))
    const menu = matches.length === 1 ? matches[0] : undefined
    const unit = units.find(unit => unit === unitGoal?.[2])
    const amount = Number(unitGoal?.[1])
    const target = unit && menu?.unit === unit && amount > 0 && amount <= Number.MAX_SAFE_INTEGER &&
      (unit === '分' || Number.isInteger(amount)) && !targetCell?.formula ? { amount, unit } : undefined
    const unresolved = !scheduled || Boolean(targetCell && !target) || matches.length > 1 ||
      row.cells.some(item => item.formula) || !menu
    const note = [cell(map.note)?.text, targetCell && !target ? targetCell.text : undefined].filter(Boolean).join(' · ')
    const item: RoutineItem = { id: 'excel-' + sheet.sourceKey + '-' + row.number, name, menuId: menu?.id,
      ...(scheduled || { schedule: 'conditional', weekdays: [], condition: scheduleCell?.text ?? '' }), target, note }
    return [{ row, item, unresolved, menu }]
  })
}


