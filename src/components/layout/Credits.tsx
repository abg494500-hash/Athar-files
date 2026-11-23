/** سطر الإعداد والإشراف أسفل الصفحات. */
export function Credits({ className = '' }: { className?: string }) {
  return (
    <footer className={`relative px-4 py-5 text-center text-[13px] leading-relaxed text-ink-500 ${className}`}>
      <p>إعداد: معلم أول أحياء <span className="font-medium text-forest-800">إيمان الهنائي</span></p>
      <p>إشراف: مديرة المدرسة الأستاذة <span className="font-medium text-forest-800">موزة بدر المعني</span></p>
    </footer>
  )
}
