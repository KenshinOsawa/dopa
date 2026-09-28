/** IndexedDB に保存する行の形。画面に渡す型（@/types）はここから作る。 */
import type { PomodoroPhase, PomodoroStatus, TaskSource, TaskStatus, XpKind } from "@/types"

export interface TaskRow {
  id: number
  title: string
  note: string
  status: TaskStatus
  sort_order: number
  date: string | null
  start_at: string | null
  end_at: string | null
  source: TaskSource
  gcal_event_id: string | null
  /** done 化で予定に ✅ を付けたとき、元のタイトル・色を退避（戻すとき用） */
  gcal_orig_title: string | null
  gcal_orig_color: string | null
  /** 書き出し失敗・未接続のとき立て、次回同期で再送する */
  gcal_dirty: boolean
  done_at: string | null
  /** 論理削除（カレンダー由来カードを消しても次の取り込みで復活させないため） */
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export interface PomodoroStateRow {
  phase: PomodoroPhase
  status: PomodoroStatus
  duration_sec: number
  elapsed_sec: number
  /** running 中の、今回の走行を始めた時刻（paused / idle は null） */
  started_at: string | null
  /** このフェーズを最初に開始した時刻（カレンダーに書く区間の開始） */
  phase_started_at: string | null
  task_id: number | null
  updated_at: string
}

export interface PomodoroSessionRow {
  id: number
  task_id: number | null
  task_title: string | null
  started_at: string
  ended_at: string
  focused_sec: number
  /** true = 時間いっぱい集中した / false = スキップ・リセットで中断 */
  completed: boolean
  gcal_event_id: string | null
  created_at: string
}

export interface XpEventRow {
  id: number
  kind: XpKind
  task_id: number | null
  pomodoro_session_id: number | null
  xp: number
  combo: number
  bonus: number
  created_at: string
}
