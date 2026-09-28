const URL_RE = /(https?:\/\/[^\s<>"'）」]+)/g

/** テキスト中の URL を自動リンク化（改行は保持）。リンク押下でカードのドラッグ・クリックを発火させない。 */
export function Linkified({ text }: { text: string }) {
  const parts = text.split(URL_RE)
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noreferrer"
            className="break-all text-cyan-300 underline-offset-2 hover:underline"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  )
}
