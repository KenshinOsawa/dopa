export const TASKS_KEY = ["tasks"] as const
export const GCAL_KEY = ["gcal-status"] as const
/** カレンダー 1 日ビュー（[...CAL_KEY, "YYYY-MM-DD"]） */
export const CAL_KEY = ["calendar-events"] as const
/** XP・レベル・連続日数 */
export const XP_KEY = ["xp"] as const
/** 今日やったこと（[...REPORT_KEY, date|"today", includeCalendar]） */
export const REPORT_KEY = ["report"] as const
/** ポモドーロ */
export const POMO_KEY = ["pomodoro"] as const
/** 最初のウェルカムを出したか */
export const WELCOME_KEY = ["welcome"] as const
