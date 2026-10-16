import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

type Props = {
  /** Short status line under the spinner */
  message?: string
  /** Optional title above the message */
  title?: string
  className?: string
  /** Spinner size classes */
  size?: "sm" | "md" | "lg"
}

const sizeClass = {
  sm: "size-5",
  md: "size-8",
  lg: "size-10",
} as const

/**
 * Full-area loading placeholder — use for page / panel waits
 * instead of skeleton slabs.
 */
export function LoadingState({
  message = "Loading…",
  title,
  className,
  size = "md",
}: Props) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-3 px-4 py-12 text-center",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <Spinner className={cn(sizeClass[size], "text-rose-500")} />
      {title ? (
        <p className="text-sm font-medium tracking-tight">{title}</p>
      ) : null}
      <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

/** Inline spinner for buttons / tight rows. */
export function InlineLoader({
  className,
  label = "Loading",
}: {
  className?: string
  label?: string
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <Spinner className="size-3.5" />
      <span className="sr-only">{label}</span>
    </span>
  )
}
