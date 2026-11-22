import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { createAppServices } from './data/provider'

/** التركيب: المنصة الحقيقية تستعمل Supabase فقط؛ عند نقص الإعداد يظهر خطأ صريح لا بيانات وهمية. */
async function bootstrap() {
  const services = createAppServices(import.meta.env)
  await services.auth?.start() // تقييم الجلسة المخزَّنة (إن وُجدت) قبل أول عرض
  createRoot(document.getElementById('root')!).render(<StrictMode><App services={services} /></StrictMode>)
}
void bootstrap()
