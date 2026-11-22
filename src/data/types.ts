export type Role = 'teacher' | 'director' | 'owner'
export type ItemStatus = 'missing' | 'on_time' | 'late'
export type SlotId = 's1' | 's2'

export interface Deadlines { base: string; late: string; replace: string } // تواريخ بصيغة YYYY-MM-DD
export interface Year { id: string; label: string; active: boolean }
export interface Term { id: string; yearId: string; name: string; order: 1 | 2; deadlines: Deadlines }

export interface Teacher {
  id: string
  name: string
  subject: string
  colorIdx: number
  active: boolean
  codeState: 'active' | 'revoked'
  codeIssuedAt: string
}

export interface SlotDef { id: SlotId; title: string; optional: boolean }

export interface Version {
  id: string
  no: number
  kind: 'file' | 'link'
  fileName?: string
  size?: number
  url?: string
  sha256: string
  storageKey?: string // يُملأ حين يُحفظ الملف عبر طبقة التخزين
  submittedAt: string // ISO
  status: ItemStatus // لقطة الحالة لحظة التسليم
  replacedNote?: string
}

export interface Submission { teacherId: string; termId: string; slotId: SlotId; versions: Version[] }

export type ActorRole = 'owner' | 'director' | 'teacher' | 'system'
export interface AuditEntry { id: string; at: string; actor: string; actorRole: ActorRole; action: string; target: string; detail?: string }

export type ArchiveStatus = 'creating' | 'awaiting_verification' | 'verified' | 'failed'
export interface ArchiveCheck { label: string; state: 'ok' | 'pending' | 'fail' }
export interface Archive {
  id: string
  title: string
  yearId: string
  termId: string | null
  teacherId: string | null
  createdAt: string
  status: ArchiveStatus
  sizeBytes: number
  entries: number
  sha256: string
  checks: ArchiveCheck[]
  sent: boolean // اكتمال الإرسال — التعريف النهائي ينتظر القرار C-05
  backupAck?: { at: string; note: string }
  deleted?: boolean
}

export const SLOTS: SlotDef[] = [
  { id: 's1', title: 'ملف الإنجاز الأساسي', optional: false },
  { id: 's2', title: 'ملف داعم', optional: true },
]

// ألوان تعريف المعلمات: باستيلية باردة تميّز كل معلمة فقط، ولا علاقة لها بحالة التسليم
// (التي لها ألوان دلالية مستقلة: ok / late / miss).
export const TEACHER_COLORS: { name: string; bg: string; fg: string; dot: string }[] = [
  { name: 'ثلجي', bg: '#dcebf7', fg: '#2e5a85', dot: '#8fb5d6' },
  { name: 'لافندر', bg: '#e6e1f4', fg: '#51459a', dot: '#a99ad4' },
  { name: 'أزرق رمادي', bg: '#dfe5ee', fg: '#3b4e69', dot: '#93a3bd' },
  { name: 'سماوي', bg: '#d9edf3', fg: '#1f5a6b', dot: '#82bccb' },
  { name: 'خزامي', bg: '#ece0f0', fg: '#6a3f7e', dot: '#bb9ccb' },
  { name: 'أزرق فاتح', bg: '#e0e8fb', fg: '#33479a', dot: '#94a5e0' },
  { name: 'رمادي ثلجي', bg: '#e4eaea', fg: '#43575a', dot: '#9cb0b2' },
  { name: 'وردي بارد', bg: '#f1e1ec', fg: '#7a3f63', dot: '#cf9fbb' },
]
