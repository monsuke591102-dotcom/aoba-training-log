import type { Category, Menu, TrainingData, Unit } from './model'

export const categories: Category[] = ['打撃', '守備', '走塁', '体づくり', 'その他']
export const units: Unit[] = ['回', '分', '秒', 'セット', '球', '本']

const seed: [string, string, Category, Unit][] = [
  ['swing', '素振り', '打撃', '回'],
  ['tee', 'ティーバッティング', '打撃', '球'],
  ['toss', 'トスバッティング', '打撃', '球'],
  ['grounder', 'ゴロ捕球', '守備', '球'],
  ['handling', 'ハンドリング', '守備', '回'],
  ['footwork', 'フットワーク', '守備', 'セット'],
  ['throw', '送球練習', '守備', '球'],
  ['outfield', '外野守備', '守備', '球'],
  ['start', 'スタート練習', '走塁', '本'],
  ['bases', 'ベースランニング', '走塁', '本'],
  ['dash', 'ダッシュ', '走塁', '本'],
  ['core', '体幹トレーニング', '体づくり', 'セット'],
  ['bodyweight', '自重トレーニング', '体づくり', 'セット'],
  ['stretch', 'ストレッチ', '体づくり', '分'],
  ['mobility', 'モビリティ', '体づくり', '分'],
  ['notebook', '野球ノート', 'その他', '分'],
  ['video', '動画によるフォーム確認', 'その他', '分'],
  ['custom', '自由メニュー', 'その他', '分'],
]

export function initialData(): TrainingData {
  const menus: Menu[] = seed.map(([id, name, category, unit]) => ({ id, name, category, unit, enabled: true }))
  return { schemaVersion: 3, menus, records: [], goals: [], plans: [], skippedMenus: [], rests: [], reflections: [] }
}




