import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, test, vi } from 'vitest'
import { BallField, normalizeFieldPoint, pitchLocationLabel, pitchPoint, StrikeZone } from './BattingDiagrams'
import { initialData } from './initialData'
import { displayPitchType, emptyMatchDetails, initialPitchTypes, isMatchDetails, pitchResultError, type Pitch, type PlateAppearance } from './matchDetails'
import { Records } from './Records'

afterEach(() => vi.unstubAllGlobals())

test('捕手視点の3×3補助線と同一点の投球番号・球種を表示する', () => {
  const location = { zone: 'point', x: .1, y: .1 } as const
  const legacy = { zone: 'outside', side: 'highLeft' } as const
  const html = renderToStaticMarkup(<StrikeZone location={location} onSelect={vi.fn()}
    pitches={[
      { id: 'pitch-1', order: 1, type: initialPitchTypes[0], location: legacy },
      { id: 'pitch-2', order: 2, type: initialPitchTypes[1], location },
      { id: 'pitch-3', order: 3, type: initialPitchTypes[3], location: { zone: 'point', x: .101, y: .102 } },
    ]} />)
  expect(html).toContain('捕手視点')
  expect(html).toContain('d="M40 20v60 M60 20v60 M20 40h60 M20 60h60"')
  expect(html.match(/class="zone-marker"/g)).toHaveLength(3)
  expect(html.match(/cx="10" cy="10"/g)).toHaveLength(2)
  expect(Number(html.match(/data-pitch-order="3" cx="([^"]+)/)?.[1])).toBeCloseTo(10.1)
  const positions = Array.from(html.matchAll(/class="zone-marker"[^>]+style="([^"]+)"/g), match => match[1])
  expect(new Set(positions).size).toBe(3)
  expect(html).toContain('1<span class="zone-marker-type">●</span>')
  expect(html).toContain('2<span class="zone-marker-type">◢</span>')
  expect(html).toContain('3<span class="zone-marker-type">▼</span>')
  expect(legacy).toEqual({ zone: 'outside', side: 'highLeft' })
})

test('旧ストレートは原本を保ちつつ標準の球種・記号で表示する', () => {
  expect(initialPitchTypes.filter(type => type.name.includes('ストレート'))).toEqual([
    { id: 'fastball', name: 'ストレート', symbol: '●' },
  ])
  for (const [id, name] of [['fastball-fast', 'ストレート（速）'], ['fastball-slow', 'ストレート（遅）']]) {
    const legacy = { id, name, symbol: '●' }
    expect(displayPitchType(legacy)).toEqual(initialPitchTypes[0])
    expect(legacy.id).toBe(id)
    expect(legacy.name).toBe(name)
  }
  const custom = { id: 'custom', name: 'チェンジアップ', symbol: '◇' }
  expect(displayPitchType(custom)).toBe(custom)
})

test('投球面は同じまま右打者と左打者を切り替えられる', () => {
  for (const side of ['right', 'left'] as const) {
    const html = renderToStaticMarkup(<StrikeZone batterSide={side} pitches={[]} onSelect={vi.fn()} />)
    expect(html).toContain(`class="strike-batter" data-batter="${side}"`)
    expect(html.match(/class="strike-grid"/g)).toHaveLength(1)
  }
})

test('投球位置は幅が変わっても同じ相対座標になり、境界とゾーン外を保持する', () => {
  expect(normalizeFieldPoint(65, 111, 250, 300)).toEqual({ x: .26, y: .37 })
  expect(normalizeFieldPoint(104, 148, 400, 400)).toEqual({ x: .26, y: .37 })
  expect(normalizeFieldPoint(0, 400, 400, 400)).toEqual({ x: 0, y: 1 })
  expect(pitchLocationLabel({ zone: 'point', x: .2, y: .8 })).toContain('ゾーン内')
  expect(pitchLocationLabel({ zone: 'point', x: .199, y: .8 })).toContain('ゾーン外')
  expect(pitchPoint({ zone: 'inside', row: 2, column: 0 })).toEqual({ x: .3, y: .7 })
  expect(pitchPoint({ zone: 'outside', side: 'lowRight' })).toEqual({ x: .9, y: .9 })
})

test('安打・安打以外を打席結果と照合し、投球の省略と旧打球を認める', () => {
  const pitch: Pitch = { id: 'p', order: 1, type: initialPitchTypes[0], result: 'hit',
    location: { zone: 'point', x: .23, y: .71 } }
  for (const result of ['single', 'double', 'triple', 'homeRun'] as const) {
    expect(pitchResultError({ result, pitches: [pitch] })).toBeUndefined()
  }
  expect(pitchResultError({ result: 'groundOut', pitches: [pitch] })).toContain('単打・二塁打')
  expect(pitchResultError({ result: 'single', pitches: [{ ...pitch, result: 'inPlayNonHit' }] })).toContain('最後の投球結果')
  expect(pitchResultError({ result: 'groundOut', pitches: [{ ...pitch, result: 'inPlayNonHit' }] })).toBeUndefined()
  expect(pitchResultError({ result: 'single', pitches: [pitch, { ...pitch, order: 2, result: 'ball' }] })).toContain('最後の投球1球')
  expect(pitchResultError({ result: 'single', pitches: [{ ...pitch, result: 'inPlay' }] })).toBeUndefined()
  expect(pitchResultError({ result: 'single' })).toBeUndefined()
  expect(pitchResultError({ pitches: [pitch] })).toBeUndefined()
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
  expect(renderToStaticMarkup(<Records data={data} commit={vi.fn()} />)).toContain('打撃を記録する')
  vi.stubGlobal('__MATCH_TEST_BUILD__', null)
  expect(renderToStaticMarkup(<Records data={data} commit={vi.fn()} />)).not.toContain('打撃を記録する')
})
