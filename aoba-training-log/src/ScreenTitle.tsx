import type { LucideIcon } from 'lucide-react'
import { FieldLines } from './BaseballArt'

export function ScreenTitle({ title, icon: Icon, text }: { title: string; icon: LucideIcon; text?: string }) {
  return <header className="screen-title">
    <FieldLines />
    <div className="screen-title-body">
      <span className="screen-icon"><Icon size={22} aria-hidden="true" /></span>
      <div><h1>{title}</h1>{text && <p>{text}</p>}</div>
    </div>
  </header>
}
