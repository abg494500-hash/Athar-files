import type { ReactNode } from 'react'
import { Credits } from './Credits'

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
      {/* خلفية الصورة (ضعي الملف في public/brand/login-bg.jpg؛ إن لم يوجد تبقى الخلفية الورقية) مع طبقة تضمن وضوح النص */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-cover bg-right" style={{ backgroundImage: "url('/brand/login-bg.jpg')" }} />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-paper-50/30 via-transparent to-paper-100/40" />
      <Leaves className="pointer-events-none absolute -bottom-10 -end-10 size-72 sm:size-96" />
      <Leaves className="pointer-events-none absolute -start-16 -top-16 size-60 -scale-x-100 rotate-180 opacity-70 sm:size-80" />
      {/* الزاوية العلوية اليمنى (بداية الصفحة في RTL): شعار وزارة التعليم ثم هوية المدرسة */}
      <header className="absolute inset-x-0 top-0 z-10 flex items-start justify-start gap-4 px-4 pt-4 sm:px-8 sm:pt-6">
        <img src="/brand/moe-logo.png" alt="وزارة التعليم" width={796} height={900} className="h-24 w-auto select-none sm:h-32" draggable={false} />
        <span aria-hidden className="mt-2 h-20 w-px bg-ink-300/60 sm:h-24" />
        <div className="mt-3 flex items-center gap-3 sm:mt-5">
          <img src="/brand/school-emblem.png" alt="" width={216} height={216} className="size-16 select-none sm:size-20" draggable={false} />
          <span className="text-base font-bold leading-tight text-forest-800 sm:text-xl">مدرسة سيح المعاشي <bdi className="font-medium text-ink-500">(١-١٢)</bdi></span>
        </div>
      </header>
      {/* المحتوى في النصف الأيسر على الشاشات الواسعة ليبقى المشهد (الأقلام) ظاهرًا يمينًا */}
      <div className="relative mt-32 flex w-full flex-col items-center sm:mt-24 lg:w-[50%] lg:self-end">
        <main className={wide ? 'relative w-full max-w-xl' : 'relative w-full max-w-[26rem]'}>{children}</main>
        <Credits className="mt-6" />
      </div>
    </div>
  )
}

/** رأس الهوية فوق نموذج الدخول: الشعار المفرغ، ثم الشعار اللفظي، ثم عنوان الصفحة. */
export function AuthHeading({ title, subtitle, logoHeight = 84 }: { title: string; subtitle?: string; logoHeight?: number }) {
  return (
    <div className="mb-6 flex flex-col items-center text-center">
      <img src="/brand/logo-symbol.png" alt="شعار أثَر" style={{ height: logoHeight, width: 'auto' }} className="select-none" draggable={false} />
      <p className="mt-3 text-2xl font-extrabold leading-tight text-forest-800 sm:text-3xl">أثَر</p>
      <p className="mt-1 text-[15px] font-medium text-ink-600">منصة ملف الإنجاز الإلكتروني</p>
      <h1 className="mt-1 text-[15px] font-medium text-ink-500">{title}</h1>
      {subtitle && <p className="mt-1 text-[13px] text-ink-500">{subtitle}</p>}
    </div>
  )
}
