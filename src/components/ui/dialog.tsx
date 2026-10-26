"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { XIcon } from "lucide-react"
import { useGT } from "gt-next"

import { cn } from "@/lib/utils"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/60",
        className
      )}
      {...props}
    />
  )
}

/**
 * Phone-width (<640px) presentation, Discord-mobile style: a bottom sheet
 * pinned to the bottom edge with a grab handle, rounded top corners, the
 * safe-area inset as bottom padding and its own scroll. Desktop is untouched
 * (every class is `max-sm:`-scoped).
 */
const MOBILE_SHEET_CLASSES =
  "max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:translate-x-0 max-sm:translate-y-0 max-sm:w-full max-sm:max-w-none max-sm:max-h-[calc(100dvh-var(--safe-area-top)-0.75rem)] max-sm:overflow-y-auto max-sm:overscroll-contain max-sm:rounded-b-none max-sm:rounded-t-2xl max-sm:border-x-0 max-sm:border-b-0 max-sm:data-[state=open]:slide-in-from-bottom max-sm:data-[state=closed]:slide-out-to-bottom max-sm:data-[state=open]:zoom-in-100 max-sm:data-[state=closed]:zoom-out-100"

function DialogContent({
  className,
  children,
  showCloseButton = true,
  mobile,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  /**
   * How the dialog presents at phone width. "sheet" (default) docks it to the
   * bottom edge; "none" leaves the caller's own layout alone. Callers that
   * already position themselves with `!important` overrides (full-screen
   * settings, custom sheets) are treated as "none" automatically.
   */
  mobile?: "sheet" | "none"
}) {
  const gt = useGT()
  const mode = mobile ?? (typeof className === "string" && className.includes("!") ? "none" : "sheet")
  const sheet = mode === "sheet"
  // Flush (p-0) dialogs lay out their own padding; only add the safe-area inset.
  const flush = typeof className === "string" && /(^|\s)p-0(\s|$)/.test(className)
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-98 data-[state=open]:zoom-in-98 data-[state=open]:slide-in-from-bottom-1 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-xl border p-6 shadow-[var(--app-elev-2)] outline-none sm:max-w-lg",
          sheet && MOBILE_SHEET_CLASSES,
          sheet && (flush
            ? "max-sm:pb-[var(--safe-area-bottom)]"
            : "max-sm:px-4 max-sm:pt-7 max-sm:pb-[calc(1rem+var(--safe-area-bottom))]"),
          className
        )}
        data-mobile={mode}
        {...props}
      >
        {sheet && (
          <span
            aria-hidden
            className="sm:hidden pointer-events-none absolute top-2 left-1/2 z-10 h-1 w-10 -translate-x-1/2 rounded-full bg-[var(--text-muted)] opacity-40"
          />
        )}
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-3 right-3 rounded-md p-1 text-[var(--text-secondary)] transition-[background-color,color] duration-(--motion-fast) hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--app-accent)] disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 max-sm:top-2 max-sm:right-2 max-sm:flex max-sm:size-11 max-sm:items-center max-sm:justify-center max-sm:rounded-full max-sm:[&_svg:not([class*='size-'])]:size-5"
          >
            <XIcon />
            <span className="sr-only">{gt("Close")}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end max-sm:[&>[data-slot=button]]:h-11 max-sm:[&>[data-slot=button]]:w-full max-sm:[&>[data-slot=button]]:text-base",
        className
      )}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
