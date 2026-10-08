import { chmod } from 'fs/promises'

export async function ensureWritable(filePath: string): Promise<void> {
  try {
    await chmod(filePath, 0o666)
  } catch {
    // Скачанный файл может не отдать атрибут. Запись всё равно пробуем.
  }
}
