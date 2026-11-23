import { useEffect, useRef, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { House, LogOut } from 'lucide-react'
import { LogoMark } from './Brand'
import { cn } from '../../lib/cn'
import { useStore } from '../../data/store'
import { VolatileDataNotice } from '../domain/VolatileDataNotice'
import { HOME_PATH, sectionsFor, type StaffRole } from '../../lib/sections'
import { Credits } from './Credits'

/**
 * الهيكل الموحّد لكل الأدوار بعد الدخول (إعادة التصميم 0.6.3، قرار A-92):
 * ترويسة ثابتة (الشعار ← الرئيسية، الاسم والدور، تسجيل الخروج) وشريط أقسام أفقي في الصفحات الداخلية للمالكة والمديرة.
 * لا شريط جانبي. التنقل الداخلي يُبنى من سجل الأقسام نفسه المستعمل في بطاقات الصفحة الرئيسية.
 */
interface Props { role: 'owner' | 'director' | 'teacher'; roleLabel: string; userName: string; children: ReactNode }

function SectionBar({ role }: { role: StaffRole }) {
  const ref = useRef<HTMLElement>(null)
  const { pathname } = useLocation()
  // يُبقي القسم النشط ظاهرًا في الشريط على الجوال.
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[aria-current="page"]')
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [pathname])
  const base = 'inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 text-[15px] font-medium transition-colors'
  const cls = ({ isActive }: { isActive: boolean }) => cn(base, isActive ? 'bg-steel-800 text-white shadow-soft' : 'bg-white text-steel-800 ring-1 ring-snow-300 hover:bg-frost-100')
  return (
    <nav ref={ref} aria-label="أقسام المنصة" className="border-b border-snow-300 bg-white/70">
      <ul className="mx-auto flex max-w-6xl snap-x gap-2 overflow-x-auto px-4 py-2.5 [scrollbar-width:none] sm:px-6 [&::-webkit-scrollbar]:hidden">
        <li className="snap-start"><NavLink to={HOME_PATH[role]} end className={cls}><House className="size-4" aria-hidden />الرئيسية</NavLink></li>
        {sectionsFor(role).map((s) => (
          <li key={s.id} className="snap-start"><NavLink to={s.to} className={cls}><s.icon className="size-4" aria-hidden />{s.label}</NavLink></li>
        ))}
      </ul>
    </nav>
  )
}

export function AppShell({ role, roleLabel, userName, children }: Props) {
  const { logout } = useStore()
  const { pathname } = useLocation()
  const go = useNavigate()
  const staff = role !== 'teacher'
  const exit = () => { logout(); go(staff ? '/login/staff' : '/login', { replace: true }) }
  const home = `/${role}`
  const onHome = pathname === home

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-snow-300 bg-white/90 backdrop-blur print:hidden">
        <div className="flex h-[4.5rem] w-full items-center gap-2 px-4 sm:px-8">
          <Link to={home} aria-label="أثَر — الصفحة الرئيسية" className="rounded-xl"><LogoMark height={58} /></Link>
          <div className="ms-auto flex items-center gap-1 sm:gap-2">
            {staff && !onHome && (
              <Link to={home} className="hidden h-11 items-center gap-2 rounded-xl px-3.5 text-[15px] font-medium text-steel-800 hover:bg-frost-100 md:inline-flex"><House className="size-4" aria-hidden />الرئيسية</Link>
            )}
            <div className="min-w-0 text-end leading-tight">
              <p className="max-w-[9rem] truncate text-sm font-bold text-steel-900 sm:max-w-[16rem]">{userName}</p>
              {roleLabel !== userName && <p className="text-[12px] text-ink-500">{roleLabel}</p>}
            </div>
            <button type="button" onClick={exit} aria-label="تسجيل الخروج" title="تسجيل الخروج"
              className="inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-xl px-3 text-[15px] font-medium text-steel-800 hover:bg-steel-100 sm:px-3.5">
              <LogOut className="size-5" aria-hidden /><span className="hidden sm:inline">تسجيل الخروج</span>
            </button>
          </div>
        </div>
        {staff && !onHome && <SectionBar role={role} />}
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-8"><VolatileDataNotice className="mb-5" />{children}</main>
      <Credits />
    </div>
  )
}
