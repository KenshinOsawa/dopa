/** テスト用: IndexedDB（fake-indexeddb）をまっさらにする。 */
import { closeDb, DB_NAME } from "@/local/db"

export async function freshDb(): Promise<void> {
  await closeDb()
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = req.onerror = req.onblocked = () => resolve()
  })
}

/** Asia/Tokyo の時刻 → ms */
export const at = (iso: string) => Date.parse(iso.includes("+") ? iso : `${iso}+09:00`)
