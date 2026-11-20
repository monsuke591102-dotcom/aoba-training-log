import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, test, vi } from 'vitest'
import { BallField, normalizeFieldPoint, StrikeZone } from './BattingDiagrams'
import { initialData } from './initialData'
import { emptyMatchDetails, initialPitchTypes, isMatchDetails, type PlateAppearance } from './matchDetails'
import { Records } from './Records'

afterEach(() => vi.unstubAllGlobals())

test('ゾーン図に9区分と8つのゾーン外ボタンがあり、選択・投球番号が表示される', () => {
  const location = { zone: 'outside', side: 'highLeft' } as const
  const html = renderToStaticMarkup(<StrikeZone location={location} onSelect={vi.fn()}
    pitches={[{ id: 'pitch-1', order: 1, type: initialPitchTypes[0], result: 'ball', location }]} />)
  expect(html.match(/class="zone-cell zone-inside"/g)).toHaveLength(9)
  expect(html.match(/class="zone-cell zone-outside"/g)).toHaveLength(8)
  expect(html).toContain('aria-label="ゾーン外・左上" aria-pressed="true"')
  expect(html).toContain('class="zone-markers" aria-hidden="true"><span>1</span>')
  expect(html).toContain('捕手視点')
})

test('球場の相対座標は端を含み、マーカーと本塁からの線に使われる', () => {
  const point = normalizeFieldPoint(80, 0, 320, 240)
  expect(point).toEqual({ x: .25, y: 0 })
  expect(normalizeFieldPoint(-4, 244, 320, 240)).toEqual({ x: 0, y: 1 })
  const html = renderToStaticMarkup(<BallField point={point} onSelect={vi.fn()} />)
  expect(html).toContain('aria-label="球場図で打球位置を指定"')
  expect(html).toContain('x1="150" y1="237" x2="75" y2="0"')
  expect(html).toContain('cx="75" cy="0"')
})

test('打席の失策位置、アウト数、打球座標、バント成否は独立して検証する', () => {
  const row: PlateAppearance = { id: 'pa', order: 1, status: 'complete', result: 'reachedOnError',
    errorPosition: 'SS', battedBall: 'bunt', bunt: 'failed', outs: 0, fieldPoint: { x: .25, y: .6 } }
  const check = (change: Partial<PlateAppearance>) =>
    isMatchDetails({ ...emptyMatchDetails(), plateAppearances: [{ ...row, ...change }] })
  expect(check({})).toBe(true)
  expect(check({ errorPosition: undefined, outs: undefined })).toBe(true)
  expect(check({ outs: 3 })).toBe(false)
  expect(check({ result: 'single' })).toBe(false)
  expect(check({ result: 'single', errorPosition: undefined })).toBe(true)
})

test('打席エディタの入口は隔離環境の試合履歴だけに出る', () => {
  const data = initialData()
  const timestamp = '2026-11-20T00:00:00.000Z'
  data.matches = [{ id: 'match-1', date: '2026-11-20', createdAt: timestamp, updatedAt: timestamp, good: '', improve: '' }]
  vi.stubGlobal('window', { isSecureContext: true, location: { origin: 'https://match.invalid' } })
  vi.stubGlobal('__LOCAL_MATCH_RECORDS__', false)
  vi.stubGlobal('__MATCH_TEST_BUILD__', { origin: 'https://match.invalid', build: 'b2' })
  expect(renderToStaticMarkup(<Records data={data} commit={vi.fn()} />)).toContain('打席を記録')
  vi.stubGlobal('__MATCH_TEST_BUILD__', null)
  expect(renderToStaticMarkup(<Records data={data} commit={vi.fn()} />)).not.toContain('打席を記録')
})
