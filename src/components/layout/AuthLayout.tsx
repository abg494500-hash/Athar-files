import type { ReactNode } from 'react'
import { LogoMark } from './Brand'

/** أوراق زخرفية هادئة في الزوايا (SVG، بلا صور خارجية): تُحاكي أوراق الشعار بشفافية عالية. */
function Leaves({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 200" className={className} aria-hidden="true" fill="none">
      <path d="M10 190C10 100 60 30 190 10C190 100 140 170 10 190Z" fill="#254337" fillOpacity=".10" />
      <path d="M10 190C60 130 110 90 190 10" stroke="#a8863f" strokeOpacity=".35" strokeWidth="2" strokeLinecap="round" />
      <path d="M40 200C40 140 80 100 150 80C150 140 110 190 40 200Z" fill="#a8863f" fillOpacity=".10" />
    </svg>
  )
}

/**
 * تخطيط الصفحة الرئيسية وشاشات الدخول: ورق دافئ، الشعار المفرغ مباشرة على الخلفية، وأوراق زخرفية خفيفة.
 * (r37) بلا مربع حول الشعار.
 */
export function AuthLayout({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-paper-100 px-4 py-10">
      <Leaves className="pointer-events-none absolute -bottom-10 -end-10 size-72 sm:size-96" />
      <Leaves className="pointer-events-none absolute -start-16 -top-16 size-60 -scale-x-100 rotate-180 opacity-70 sm:size-80" />
      <main className={wide ? 'relative w-full max-w-xl' : 'relative w-full max-w-[26rem]'}>{children}</main>
    </div>
  )
}

/** رأس الهوية فوق نموذج الدخول: الشعار المفرغ، ثم الشعار اللفظي، ثم عنوان الصفحة. */
export function AuthHeading({ title, subtitle, logoHeight = 104 }: { title: string; subtitle?: string; logoHeight?: number }) {
  return (
    <div className="mb-6 flex flex-col items-center text-center">
      <LogoMark height={logoHeight} />
      <p className="mt-3 text-xl font-bold leading-tight text-forest-800 sm:text-2xl">منصة ملف الإنجاز الإلكتروني</p>
      <h1 className="mt-1 text-[15px] font-medium text-ink-500">{title}</h1>
      {subtitle && <p className="mt-1 text-[13px] text-ink-500">{subtitle}</p>}
    </div>
  )
}
