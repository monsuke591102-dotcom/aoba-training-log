import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, test, vi } from 'vitest'
import { BallField, normalizeFieldPoint, pitchLocationLabel, pitchPoint, StrikeZone } from './BattingDiagrams'
import { initialData } from './initialData'
import { displayPitchType, emptyMatchDetails, initialPitchTypes, isMatchDetails, pitchResultError, type Pitch, type PlateAppearance } from './matchDetails'
import { Records } from './Records'
import { pitchCatalog } from './BattingEditor'
import { contactPitchResult } from './matchDetails'

test('追加球種候補は所有者から渡された打席だけを使い、名称を重複させない', () => {
  const plate = (id: string, name: string): PlateAppearance => ({
    id, order: 1, status: 'complete', result: 'walk',
    pitches: [{ id: 'pitch-' + id, order: 1, result: 'ball', type: { id, name }, location: { zone: 'point', x: .5, y: .5 } }],
  })
  const a = plate('a', 'チェンジアップ')
  const duplicate = plate('duplicate', 'ﾁｪﾝｼﾞｱｯﾌﾟ')
  expect(pitchCatalog([a, duplicate]).slice(initialPitchTypes.length)).toEqual([a.pitches![0].type])
  expect(pitchCatalog([])).toEqual(initialPitchTypes)
  expect(duplicate.pitches![0].type.name).toBe('ﾁｪﾝｼﾞｱｯﾌﾟ')
})

test('明示した打球は既存の保存値に対応し、非打球を打球にしない', () => {
  expect(contactPitchResult('homeRun')).toBe('hit')
  for (const result of ['groundOut', 'reachedOnError', 'sacrificeBunt', 'sacrificeFly', 'fieldersChoice', 'otherOut'] as const) {
    expect(contactPitchResult(result)).toBe('inPlayNonHit')
  }
  for (const result of ['walk', 'hitByPitch', 'droppedThirdStrike', 'strikeoutLooking', 'interference'] as const) {
    expect(contactPitchResult(result)).toBeUndefined()
  }
})

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
  expect(html.match(/<line /g)).toHaveLength(2)
  expect(html.match(/<circle data-pitch-order=/g)).toHaveLength(2)
  expect(html).not.toContain('<circle data-pitch-order="1"')
  expect(html).toContain('<circle data-pitch-order="2" cx="10" cy="10"')
  expect(Number(html.match(/data-pitch-order="3" cx="([^"]+)/)?.[1])).toBeCloseTo(10.1)
  const positions = Array.from(html.matchAll(/class="zone-marker"[^>]+style="([^"]+)"/g), match => match[1])
  expect(new Set(positions).size).toBe(3)
  for (const [order, symbol] of [[1, '●'], [2, '◣'], [3, '▼']] as const) {
    expect(html).toMatch(new RegExp(`data-symbol="${symbol}"[^>]*aria-label="${order}球目[^>]*>[\\s\\S]*?<text class="zone-marker-number"[^>]*>${order}</text>`))
  }
  expect(legacy).toEqual({ zone: 'outside', side: 'highLeft' })
})

test('単独のカーブとストレートは、端への収まり調整を含めて白い点と引き出し線を表示しない', () => {
  const pitch = { id: 'point', order: 1, type: initialPitchTypes[0], result: 'foul' } as const
  const html = renderToStaticMarkup(<StrikeZone onSelect={vi.fn()} pitches={[
    { ...pitch, type: initialPitchTypes[1], location: { zone: 'point', x: .27, y: .64 } },
    { ...pitch, id: 'edge', order: 2, location: { zone: 'point', x: 1, y: 0 } },
  ]} />)
  expect(html).toContain('data-pitch-order="1" style="left:27%;top:64%"')
  expect(html).toContain('data-symbol="◣"')
  expect(html).toContain('data-symbol="●"')
  expect(html).not.toContain('<line ')
  expect(html).not.toContain('<circle data-pitch-order=')
})

test('明示ストライクとボールを色分けし、打球アウトは対応する最終投球だけを赤にする', () => {
  const location = { zone: 'point', x: .5, y: .5 } as const
  const results = ['calledStrike', 'swingingStrike', 'ball', 'foul', 'foulBunt', 'hitByPitch', 'inPlayNonHit'] as const
  const pitches = results.map((result, i) => ({ id: 'p-' + i, order: i + 1, type: initialPitchTypes[0], result, location }))
  const tones = (rows: typeof pitches, result?: PlateAppearance['result']) =>
    Array.from(renderToStaticMarkup(<StrikeZone pitches={rows} plateResult={result} onSelect={vi.fn()} />)
      .matchAll(/data-tone="([^"]+)"/g), match => match[1])
  expect(tones(pitches, 'groundOut')).toEqual(['strike', 'strike', 'ball', 'strike', 'strike', 'neutral', 'out'])
  expect(tones(pitches, 'reachedOnError').at(-1)).toBe('neutral')
  expect(tones(pitches, 'fieldersChoice').at(-1)).toBe('neutral')
  expect(tones(pitches, 'sacrificeFly').at(-1)).toBe('neutral')
  expect(tones(pitches).at(-1)).toBe('neutral')
  expect(tones(pitches.slice(0, 2), 'strikeoutSwinging')).toEqual(['strike', 'strike'])
  expect(tones([...pitches, { ...pitches[0], id: 'next', order: 8 }], 'groundOut').at(-2)).toBe('neutral')
  expect(tones([...pitches, { ...pitches[6], id: 'ambiguous', order: 8 }], 'groundOut').slice(-2))
    .toEqual(['neutral', 'neutral'])
})

test('4種類の安打を最終投球にだけ関連付け、旧打球・矛盾・欠落を区別する', () => {
  const location = { zone: 'point', x: .4, y: .6 } as const
  const pitch = { id: 'last', order: 2, type: initialPitchTypes[0], location, result: 'hit' } as const
  const ball = { ...pitch, id: 'first', order: 1, result: 'ball' } as const
  const tones = (rows: React.ComponentProps<typeof StrikeZone>['pitches'], result?: PlateAppearance['result']) =>
    Array.from(renderToStaticMarkup(<StrikeZone pitches={rows} plateResult={result} onSelect={vi.fn()} />)
      .matchAll(/data-tone="([^"]+)"/g), match => match[1])
  for (const result of ['single', 'double', 'triple', 'homeRun'] as const) {
    expect(tones([ball, pitch], result)).toEqual(['ball', 'hit'])
    expect(tones([ball, { ...pitch, result: 'inPlay' }], result)).toEqual(['ball', 'hit'])
  }
  expect(tones([ball], 'single')).toEqual(['ball'])
  expect(tones([pitch], 'groundOut')).toEqual(['neutral'])
  expect(tones([pitch])).toEqual(['hit'])
  expect(tones([{ ...pitch, result: 'inPlay' }])).toEqual(['neutral'])
  expect(tones([{ ...pitch, result: 'inPlayNonHit' }], 'single')).toEqual(['neutral'])
  expect(tones([pitch, { ...ball, order: 3 }], 'single')).toEqual(['neutral', 'ball'])
  expect(tones([{ ...pitch, id: 'old', order: 1, result: 'inPlay' }, pitch], 'single')).toEqual(['neutral', 'neutral'])
  expect(tones([{ ...pitch, result: 'inPlay' }], 'groundOut')).toEqual(['out'])
})

test('共通のシュート定義から右向き三角形を描き、その重心に投球番号を表示する', () => {
  const shoots = initialPitchTypes.filter(type => type.name === 'シュート')
  expect(shoots).toEqual([{ id: 'shoot', name: 'シュート', symbol: '▶' }])
  expect(new Set(initialPitchTypes.map(type => type.id)).size).toBe(initialPitchTypes.length)
  const html = renderToStaticMarkup(<StrikeZone onSelect={vi.fn()} pitches={[
    { id: 'shoot-pitch', order: 12, type: shoots[0], result: 'ball', location: { zone: 'point', x: 1, y: 1 } },
  ]} />)
  expect(html).toContain('data-symbol="▶" data-tone="ball"')
  expect(html).toContain('aria-label="12球目 · シュート"')
  expect(html).toContain('<polygon class="zone-marker-symbol" points="0,0 100,50 0,100"')
  expect(html).toMatch(/<text class="zone-marker-number" x="33" y="50"[^>]*text-anchor="middle"[^>]*>12<\/text>/)
  expect(html).not.toContain('<circle data-pitch-order=')
})

test('保存済みのカーブは元のスナップショットを保ち、選択肢と同じ左下の三角形で表示する', () => {
  const legacy = { id: 'curve', name: 'カーブ', symbol: '◢' }
  const curve = initialPitchTypes.find(type => type.id === 'curve')
  expect(curve?.symbol).toBe('◣')
  expect(displayPitchType(legacy)).toEqual(curve)
  const html = renderToStaticMarkup(<StrikeZone onSelect={vi.fn()} plateResult="single" pitches={[
    { id: 'curve-pitch', order: 1, type: legacy, result: 'hit', location: { zone: 'point', x: .5, y: .5 } },
  ]} />)
  expect(html).toContain('data-symbol="◣" data-tone="hit"')
  expect(html).toContain('<polygon class="zone-marker-symbol" points="0,0 100,100 0,100"')
  expect(html).toMatch(/<text class="zone-marker-number" x="33" y="67"[^>]*>1<\/text>/)
  expect(legacy.symbol).toBe('◢')
  const custom = { ...legacy, id: 'custom' }
  expect(displayPitchType(custom)).toBe(custom)
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

test('投球コース図は捕手視点の補助線と位置表示だけを描画する', () => {
  const html = renderToStaticMarkup(<StrikeZone pitches={[]} onSelect={vi.fn()} />)
  expect(html).toContain('捕手視点')
  expect(html.match(/<svg/g)).toHaveLength(2)
  expect(html).not.toContain('strike-batter')
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
