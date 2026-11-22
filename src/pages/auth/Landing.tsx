import { Link } from 'react-router-dom'
import { User } from 'lucide-react'
import { AuthLayout } from '../../components/layout/AuthLayout'
import { LogoMark } from '../../components/layout/Brand'

/** الصفحة الرئيسية العامة: الشعار المفرغ وسطر صغير باسم المنصة وزر دخول المعلمات؛ دخول الإدارة رابط هادئ منفصل. */
export default function Landing() {
  return (
    <AuthLayout wide>
      <div className="flex flex-col items-center text-center">
        <LogoMark height={190} />
        <h1 className="mt-3 text-[15px] font-medium text-ink-600">منصة ملف الإنجاز الإلكتروني</h1>
        <Link to="/login" className="mt-8 inline-flex h-14 items-center justify-center gap-2.5 rounded-full bg-forest-800 px-9 text-lg font-bold text-white shadow-soft transition-colors hover:bg-forest-900 focus-visible:outline-offset-4">
          <User className="size-5" aria-hidden />تسجيل الدخول
        </Link>
      </div>
    </AuthLayout>
  )
}
