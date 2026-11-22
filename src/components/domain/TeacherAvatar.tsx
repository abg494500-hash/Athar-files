import { TEACHER_COLORS, type Teacher } from '../../data/types'

export function TeacherAvatar({ teacher, size = 40 }: { teacher: Pick<Teacher, 'name' | 'colorIdx'>; size?: number }) {
  const c = TEACHER_COLORS[teacher.colorIdx % TEACHER_COLORS.length]
  const initial = teacher.name.replace(/^(أ\.|م\.)\s*/, '').trim().charAt(0)
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-full font-bold" style={{ width: size, height: size, background: c.bg, color: c.fg, fontSize: size * 0.42 }}>
      {initial}
    </span>
  )
}
