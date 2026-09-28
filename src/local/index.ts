/**
 * ブラウザ内の「バックエンド」。hooks から直接呼ぶ（サーバーは無い）。
 * データは IndexedDB（このブラウザの中）だけ。Google カレンダーは接続したときだけ直接叩く。
 */
export { createTask, deleteTask, importText, listTasks, moveTask, updateTask } from "./tasks"
export { pomodoro, savePomodoroSettings } from "./pomodoro"
export { getReport, saveDayStartHour, saveNote } from "./report"
export { exportData, importData, parseBackup, wipeAll, backupFileName } from "./backup"
export { finishWelcome, isWelcomed } from "./welcome"
export { dayStartHour, getSetting, pomodoroSettings, setSettings } from "./settings"
export { getXpStats } from "./xpStats"
export { gcalStatus, gcalSync } from "./gcal/status"
export { createEvent, deleteEvent, listDay, patchEvent } from "./gcal/view"
export { installGcalHooks } from "./gcal/sync"
