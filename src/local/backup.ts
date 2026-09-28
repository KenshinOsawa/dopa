/**
 * データのエクスポート / インポート / 全削除（端末の引っ越し・バックアップ用）。
 * ファイルは JSON 1 つ。インポートは「今のデータを置き換える」。
 */
import { AppError } from "@/lib/errors"
import { localIso } from "@/lib/time"
import { broadcast } from "./bus"
import { getDb, locked, STORES, type StoreName } from "./db"

export const BACKUP_APP = "dopa"
export const BACKUP_VERSION = 1

export interface Backup {
  app: typeof BACKUP_APP
  version: number
  exported_at: string
  data: Record<StoreName, unknown[]>
}

export async function exportData(nowMs = Date.now()): Promise<Backup> {
  const db = await getDb()
  const tx = db.transaction(STORES, "readonly")
  const data = {} as Record<StoreName, unknown[]>
  for (const name of STORES) data[name] = await tx.objectStore(name).getAll()
  await tx.done
  return { app: BACKUP_APP, version: BACKUP_VERSION, exported_at: localIso(nowMs), data }
}

export function parseBackup(text: string): Backup {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new AppError("JSON として読めませんでした")
  }
  const b = parsed as Partial<Backup>
  if (!b || b.app !== BACKUP_APP || typeof b.data !== "object" || b.data === null) {
    throw new AppError("dopa のバックアップファイルではありません")
  }
  if (typeof b.version !== "number" || b.version > BACKUP_VERSION) {
    throw new AppError("新しい版のバックアップです（アプリを更新してから読み込んでください）")
  }
  for (const name of STORES) {
    const rows = (b.data as Record<string, unknown>)[name]
    if (rows !== undefined && !Array.isArray(rows)) throw new AppError(`バックアップの形式が不正です（${name}）`)
  }
  return b as Backup
}

async function replaceAll(data: Partial<Record<StoreName, unknown[]>>): Promise<void> {
  await locked(async () => {
    const db = await getDb()
    const tx = db.transaction(STORES, "readwrite")
    for (const name of STORES) {
      const store = tx.objectStore(name)
      await store.clear()
      for (const row of data[name] ?? []) await (store as unknown as { put: (v: unknown) => Promise<unknown> }).put(row)
    }
    await tx.done
  })
  broadcast("all")
}

/** 今のデータを消してバックアップの中身に置き換える */
export async function importData(backup: Backup): Promise<{ tasks: number }> {
  await replaceAll(backup.data)
  return { tasks: (backup.data.tasks ?? []).length }
}

/** 全部消す（ウェルカムからやり直し） */
export async function wipeAll(): Promise<void> {
  await replaceAll({})
}

export function backupFileName(nowMs = Date.now()): string {
  const iso = localIso(nowMs)
  return `dopa-backup-${iso.slice(0, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}.json`
}
