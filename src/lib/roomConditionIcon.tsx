import { Droplets, Sparkles, Wrench, type LucideIcon } from 'lucide-react'
import type { RoomCondition } from '@shared/types'

/** Real icons for room condition, shown wherever it renders as JSX (badges, chips). Native <select> options keep the emoji label, which is plain text and needs no icon system. */
export const ROOM_CONDITION_ICON: Record<RoomCondition, LucideIcon> = {
  bersih: Sparkles,
  kotor: Droplets,
  rusak: Wrench,
}
