import { HashRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { StoreProvider, useStore } from './data/store'
import type { AppServices } from './data/services'
import { AuthProvider } from './lib/auth/AuthContext'
import { DataGate } from './components/layout/DataGate'
import { ToastProvider } from './components/ui/Toast'
import { StorageProvider } from './lib/storage'
import { AppShell } from './components/layout/AppShell'
import type { Role } from './data/types'
import { StaffLogin, TeacherLogin } from './pages/auth/Login'
import Landing from './pages/auth/Landing'
import TeacherHome from './pages/teacher/TeacherHome'
import TeacherPortal from './pages/teacher/Portal'
import UploadSessions from './pages/owner/UploadSessions'
import { TeacherPortalProvider } from './lib/teacherAuth/TeacherPortalContext'
import { StaffApiProvider } from './lib/staffApi/StaffApiContext'
import StaffHome from './pages/shared/Home'
import SubmissionsBoard from './pages/shared/SubmissionsBoard'
import DirectorOverview from './pages/director/Overview'
import TeachersList from './pages/shared/TeachersList'
import TeacherDetail from './pages/shared/TeacherDetail'
import Reports from './pages/director/Reports'
import DeadlinesManager from './pages/shared/DeadlinesManager'
import OwnerDashboard from './pages/owner/Dashboard'
import YearsTerms from './pages/owner/YearsTerms'
import TeachersAdmin from './pages/owner/TeachersAdmin'
import ArchivePage from './pages/owner/Archive'
import YearResetPage from './pages/owner/YearReset'

function Guard({ role }: { role: Role }) {
  const { session, teachers } = useStore()
  if (!session || session.role !== role) return <Navigate to="/login" replace />
  const name = role === 'teacher' ? (teachers.find((t) => t.id === session.teacherId)?.name ?? '') : role === 'owner' ? 'المالكة' : 'مديرة المدرسة'
  const label = role === 'teacher' ? 'معلمة' : role === 'owner' ? 'المالكة' : 'مديرة المدرسة'
  return <AppShell role={role} roleLabel={label} userName={name}><DataGate><Outlet /></DataGate></AppShell>
}

function Home() {
  const { session } = useStore()
  return session ? <Navigate to={`/${session.role}`} replace /> : <Landing />
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<TeacherLogin />} />
      <Route path="/login/staff" element={<StaffLogin />} />
      <Route path="/teacher/portal" element={<TeacherPortal />} />
      <Route element={<Guard role="teacher" />}>
        <Route path="/teacher" element={<TeacherHome />} />
      </Route>
      <Route element={<Guard role="director" />}>
        <Route path="/director" element={<Navigate to="/director/teachers" replace />} />
        <Route path="/director/overview" element={<DirectorOverview />} />
        <Route path="/director/teachers" element={<SubmissionsBoard base="/director/teachers" />} />
        <Route path="/director/teachers/list" element={<TeachersList base="/director/teachers" />} />
        <Route path="/director/teachers/:id" element={<TeacherDetail backTo="/director/teachers" />} />
        <Route path="/director/years" element={<YearsTerms />} />
        <Route path="/director/register" element={<TeachersAdmin role="director" />} />
        <Route path="/director/reports" element={<Reports />} />
        <Route path="/director/deadlines" element={<DeadlinesManager role="director" />} />
      </Route>
      <Route element={<Guard role="owner" />}>
        <Route path="/owner" element={<StaffHome role="owner" />} />
        <Route path="/owner/overview" element={<OwnerDashboard />} />
        <Route path="/owner/submissions" element={<SubmissionsBoard base="/owner/submissions" />} />
        <Route path="/owner/submissions/:id" element={<TeacherDetail backTo="/owner/submissions" />} />
        <Route path="/owner/years" element={<YearsTerms />} />
        <Route path="/owner/teachers" element={<TeachersAdmin role="owner" />} />
        <Route path="/owner/deadlines" element={<DeadlinesManager role="owner" />} />
        <Route path="/owner/archive" element={<ArchivePage />} />
        <Route path="/owner/uploads" element={<UploadSessions />} />
        <Route path="/owner/year-reset" element={<YearResetPage />} />
      </Route>
      <Route path="*" element={<Home />} />
    </Routes>
  )
}

export default function App({ services }: { services: AppServices }) {
  return (
      <StorageProvider>
      <AuthProvider controller={services.auth}>
      <StoreProvider repository={services.repository}>
        <ToastProvider>
          <TeacherPortalProvider>
            <StaffApiProvider getToken={services.auth?.getAccessToken ? () => services.auth!.getAccessToken!() : undefined}>
              <HashRouter>
                <AppRoutes />
              </HashRouter>
            </StaffApiProvider>
          </TeacherPortalProvider>
        </ToastProvider>
      </StoreProvider>
      </AuthProvider>
      </StorageProvider>
  )
}
