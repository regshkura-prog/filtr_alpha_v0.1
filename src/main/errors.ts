export const FILE_BUSY_MESSAGE = 'Файл занят другой программой. Закройте его и попробуйте снова.'

export function isFileBusy(error: unknown): boolean {
  if (error instanceof Error && error.message === FILE_BUSY_MESSAGE) return true
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === 'EPERM' || code === 'EBUSY'
}

export function toFileAccessError(error: unknown, fallback: string): Error {
  if (isFileBusy(error)) return new Error(FILE_BUSY_MESSAGE)
  if (error instanceof Error && error.message.trim()) return error
  return new Error(fallback)
}
