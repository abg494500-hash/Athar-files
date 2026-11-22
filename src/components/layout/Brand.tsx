import iconUrl from '../../assets/brand/icon.png'
import logoMarkUrl from '../../assets/brand/logo-mark.png'
import { cn } from '../../lib/cn'

/** رمز التطبيق المرجعي كما هو (مقتطع من صورة الهوية دون تعديل) بجانب اسم المنصة. */
export function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <span className="inline-block shrink-0 overflow-hidden" style={{ width: size, height: size, borderRadius: size * 0.24 }}>
      <img src={iconUrl} alt="" className="size-full scale-[1.12] object-cover" draggable={false} />
    </span>
  )
}

/**
 * الشعار المفرغ (خلفية شفافة): أوراق وطائر «أثر» بالأخضر والذهبي مع كلمة «أثر»، بلا مربع ولا إطار، فيندمج مع أي خلفية فاتحة.
 * مستخرج من نسخة الهوية الفاتحة نفسها دون تغيير شكله (إزالة الخلفية الكريمية فقط).
 */
export function LogoMark({ height = 120, className }: { height?: number; className?: string }) {
  return <img src={logoMarkUrl} alt="شعار أثَر" height={height} style={{ height, width: 'auto' }} className={cn('select-none', className)} draggable={false} />
}

export function Brand({ light, className, showCaption = true }: { light?: boolean; className?: string; showCaption?: boolean }) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <BrandMark size={42} />
      <div className="leading-tight">
        <p className={cn('text-xl font-bold', light ? 'text-white' : 'text-steel-900')}>أثَر</p>
        {showCaption && <p className={cn('text-[12px]', light ? 'text-steel-200' : 'text-ink-500')}>منصة ملف الإنجاز الإلكتروني</p>}
      </div>
    </div>
  )
}
