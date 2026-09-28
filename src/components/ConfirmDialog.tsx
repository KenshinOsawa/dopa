import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"

interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
  pending?: boolean
}

/** window.confirm() の代わりの確認ダイアログ（open のときだけマウントする）。 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose,
  pending,
}: ConfirmDialogProps) {
  return (
    <Dialog open onClose={onClose} className="max-w-sm" labelledBy="confirm-dialog-title" hideClose>
      <div className="p-5">
        <h2 id="confirm-dialog-title" className="text-base font-semibold text-zinc-50">
          {title}
        </h2>
        <p className="mt-2 text-sm break-words text-zinc-300">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} autoFocus>
            キャンセル
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={pending}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
