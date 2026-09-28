import { getDb } from "./db"
import { computeStats } from "./xp"
import type { XpStats } from "@/types"

export async function getXpStats(nowMs = Date.now()): Promise<XpStats> {
  return computeStats(await (await getDb()).getAll("xp"), nowMs)
}
