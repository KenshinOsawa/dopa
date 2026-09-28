/** 画面とブラウザ内データ層（src/local）のあいだの型。 */
export type TaskStatus = "todo" | "doing" | "done"
export type TaskSource = "manual" | "calendar"

export interface Task {
  id: number
  title: string
  note: string
  status: TaskStatus
  sort_order: number
  /** YYYY-MM-DD（ローカル） */
  date: string | null
  /** ISO 8601（常にこのブラウザのオフセット付き。lib/time.ts） */
  start_at: string | null
  end_at: string | null
  source: TaskSource
  gcal_event_id: string | null
  /** やった列へ移した時刻（done 以外・列追加前からの done は null） */
  done_at: string | null
  created_at: string
  updated_at: string
}

export interface UpdateTaskInput {
  title?: string
  note?: string
  date?: string | null
  start_at?: string | null
  end_at?: string | null
}

export interface CreateTaskInput extends UpdateTaskInput {
  title: string
  /** 追加する列（省略 = todo） */
  status?: TaskStatus
  /** このカードの直前に入れる（省略 / null = 列の末尾） */
  before_id?: number | null
}

export interface MoveInput {
  id: number
  status: TaskStatus
  /** このカードの直前に置く（null = 列の末尾） */
  before_id: number | null
}

export interface BulkResult {
  created: number
  updated: number
  tasks: Task[]
}

export interface GcalStatus {
  /** OAuth クライアント ID があるか（無ければ連携 UI を出さない） */
  configured: boolean
  /** 一度接続したが、トークンの期限が切れている（「再接続」を出す） */
  needs_reconnect: boolean
  logged_in: boolean
  last_sync_at: string | null
  last_error: string | null
  message: string | null
}

export type DateFilter = "today" | "tomorrow" | "all"

// ──── ポモドーロ ────
export type PomodoroPhase = "focus" | "break"
export type PomodoroStatus = "idle" | "running" | "paused"

export interface PomodoroSettings {
  focus_minutes: number
  break_minutes: number
  gcal_enabled: boolean
  /** 集中 → 休憩 → 集中 … を止めるまで自動で回す（既定オン。オフ = 休憩明けは「開始」待ち） */
  auto_cycle: boolean
}

export interface Pomodoro {
  phase: PomodoroPhase
  status: PomodoroStatus
  duration_sec: number
  elapsed_sec: number
  started_at: string | null
  /** running 中のみ: このフェーズが終わる時刻 */
  ends_at: string | null
  /** 取得時点の残り秒（running 中は ends_at と now から計算し直す） */
  remaining_sec: number
  server_now: string
  task_id: number | null
  task_title: string | null
  today_count: number
  settings: PomodoroSettings
}

// ──── カレンダー（1 日ビュー）────
export type EventKind = "card" | "pomodoro" | "event"

export interface CalendarEvent {
  id: string
  title: string
  /** 時刻付き予定（ローカルのオフセット付き ISO）。終日予定は null */
  start: string | null
  end: string | null
  all_day: boolean
  /** 終日予定の期間（end_date は含まない） */
  start_date: string | null
  end_date: string | null
  color_id: string | null
  html_link: string | null
  /** 繰り返し予定のインスタンス（id はインスタンス ID） */
  recurring: boolean
  kind: EventKind
  task_id: number | null
  done: boolean
  /** 自分の出欠（招待でなければ null） */
  response: string | null
  can_edit: boolean
}

export interface CalendarDay {
  logged_in: boolean
  message: string | null
  date: string
  days: number
  events: CalendarEvent[]
}

export interface CalendarEventPatch {
  title?: string
  start?: string
  end?: string
}

export interface CalendarEventCreate {
  title: string
  start: string
  end: string
  note?: string
}

export interface CalendarCreateResult {
  task: Task
  /** 書き出しに失敗したとき（次回同期で再送）は null */
  event: CalendarEvent | null
}

// ──── XP・レベル・連続日数 ────
export type XpKind = "doing" | "done" | "focus"

export interface XpStats {
  total_xp: number
  level: number
  /** 今のレベルの開始 XP / 次のレベルの開始 XP（ゲージ用） */
  level_start: number
  next_level_at: number
  today_xp: number
  daily_goal: number
  /** XP を得た日の連続（凍結で守った日は数えない） */
  streak_days: number
  /** 今日すでに XP を得たか */
  streak_today: boolean
  /** 次に 1 日休んでも凍結で守れるか（7 日に 1 回まで） */
  freeze_ready: boolean
  /** 凍結で守った日（YYYY-MM-DD、新しい順） */
  frozen_dates: string[]
  /** 直近の「やった」から 10 分以内ならそのコンボ数（切れていれば 0） */
  combo: number
  combo_until: string | null
  last_event_id: number | null
  server_now: string
}

/** 今回の操作で付与した XP */
export interface XpAward {
  event_id: number
  kind: XpKind
  xp: number
  combo: number
  bonus: number
  stats: XpStats
}

/** moveTask の返り値 */
export interface MoveResult extends Task {
  /** 付与なし（2 回目以降・同じ列内の並べ替え）は null */
  xp: XpAward | null
}

// ──── 今日やったこと（日報）────
export interface ReportItem {
  id: number
  title: string
  source: TaskSource
  /** done の項目だけ（やったへ移した時刻） */
  done_at: string | null
}

export interface Report {
  /** 日報の日 YYYY-MM-DD（ローカル・朝 day_start_hour 時が境界） */
  date: string
  day_start_hour: number
  /** 今の「日報の日」か（doing は今日のときだけ載る） */
  is_today: boolean
  include_calendar: boolean
  done: ReportItem[]
  doing: ReportItem[]
  todo: ReportItem[]
  /** 除外したカレンダー由来カードの数 */
  excluded_calendar: number
  note: string
  /** 一言込みの本文 */
  text: string
}

export interface ReportNote {
  date: string
  note: string
}
