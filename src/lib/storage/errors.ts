// أخطاء طبقة التخزين. رموز ثابتة تُترجَم لرسائل عربية في الواجهة (describeStorageError).
export type StorageErrorCode =
  | 'empty'
  | 'too_large'
  | 'type_not_allowed'
  | 'provider_limit'
  | 'already_exists'
  | 'not_found'
  | 'invalid_key'
  | 'aborted'
  | 'delete_not_implemented'

export class StorageError extends Error {
  code: StorageErrorCode
  constructor(code: StorageErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'StorageError'
    this.code = code
  }
}

/** رسالة عربية مناسبة للمستخدمة. تعيد null عند الإلغاء (لا تُعرض رسالة). حد الحجم يُمرَّر نصًا جاهزًا (لا قيمة ثابتة هنا). */
export function describeStorageError(err: unknown, limitText?: string): string | null {
  if (err instanceof StorageError) {
    switch (err.code) {
      case 'aborted': return null
      case 'too_large':
      case 'provider_limit': return limitText ? `حجم الملف أكبر من الحد المسموح (${limitText}).` : 'حجم الملف أكبر من الحد المسموح.'
      case 'type_not_allowed': return 'نوع الملف غير مدعوم.'
      case 'empty': return 'الملف فارغ.'
      case 'already_exists': return 'تعذّر الحفظ لأن اسم التخزين مكرر. أعيدي المحاولة.'
      case 'delete_not_implemented': return 'الحذف غير مفعّل في هذه المرحلة.'
      default: return 'تعذّر رفع الملف. أعيدي المحاولة.'
    }
  }
  return 'تعذّر رفع الملف. أعيدي المحاولة.'
}
