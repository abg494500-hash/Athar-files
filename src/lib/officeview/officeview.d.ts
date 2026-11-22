export type OfficeErrorCode = 'unsupported' | 'unsupported_browser' | 'encrypted' | 'too_large' | 'corrupt'
declare global {
  interface Window { AtharOffice?: { SUPPORTED: Record<string, 1>; render(buf: ArrayBuffer, ext: string): Promise<HTMLElement> } }
}
