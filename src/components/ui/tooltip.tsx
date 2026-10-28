"use client"

import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/lib/utils"
import { parseShortcut } from "@/lib/ui/titleTooltip"

/**
 * Set by TooltipProvider so a Tooltip inside one joins its delay group (the
 * first tooltip waits `delayDuration`, moving to a neighbour within
 * `skipDelayDuration` opens it instantly) instead of creating its own
 * provider. A Tooltip outside any provider still works on its own.
 *
 * One app-wide provider is mounted in AppProviders (root layout); nested
 * providers (rail, badges) only exist to use a different delay.
 */
const TooltipGroupContext = React.createContext(false)

function TooltipProvider({
  delayDuration = 300,
  skipDelayDuration = 300,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipGroupContext.Provider value>
      <TooltipPrimitive.Provider
        data-slot="tooltip-provider"
        delayDuration={delayDuration}
        skipDelayDuration={skipDelayDuration}
        {...props}
      />
    </TooltipGroupContext.Provider>
  )
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const inGroup = React.useContext(TooltipGroupContext)
  const root = <TooltipPrimitive.Root data-slot="tooltip" {...props} />
  if (inGroup) return root
  return <TooltipProvider>{root}</TooltipProvider>
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

const TOOLTIP_VARIANTS = {
  /** Compact label chip on the solid theme surface (globals.css `.tooltip-surface`). */
  default: "tooltip-surface",
  /** Rich content (title, description, icons) on the app's card surface. */
  card:
    "max-w-[min(320px,calc(100vw-1.5rem))] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3 text-sm text-[var(--text-primary)] shadow-[var(--app-elev-2)] [--tooltip-arrow:var(--bg-card)] [--tooltip-arrow-border:var(--border-subtle)]",
} as const

/**
 * Keycap chips for a shortcut hint: `"Ctrl+K"`, `"⌘ + Shift + P"` or
 * `["Ctrl", "K"]`. Shared by TooltipContent's `shortcut` prop and usable on
 * its own inside custom tooltip content.
 */
function TooltipShortcut({ keys, className }: { keys: string | readonly string[]; className?: string }) {
  const list = typeof keys === "string" ? (parseShortcut(keys) ?? [keys]) : keys
  if (list.length === 0) return null
  return (
    <span className={cn("tooltip-kbd-row", className)} aria-hidden="true">
      {list.map((k, i) => (
        <kbd key={`${k}-${i}`} className="tooltip-kbd">
          {k}
        </kbd>
      ))}
    </span>
  )
}

/** `bg-[var(--x)]` / `border-[var(--x)]` in a caller's className → that colour. */
function arbitraryVarColor(className: unknown, prefix: "bg" | "border"): string | null {
  if (typeof className !== "string") return null
  const m = new RegExp(`(?:^|\\s)${prefix}-\\[(var\\(--[\\w-]+\\))\\]`).exec(className)
  return m ? m[1] : null
}

function TooltipContent({
  className,
  style,
  sideOffset = 6,
  variant = "default",
  arrow,
  shortcut,
  description,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content> & {
  variant?: keyof typeof TOOLTIP_VARIANTS
  /**
   * Show the pointer arrow. Defaults to on. A caller that paints its own
   * surface with `bg-[var(--token)]` (and optionally `border-[var(--token)]`)
   * gets a matching arrow automatically; any other `bg-*` class turns it off
   * unless `arrow` is passed together with a `[--tooltip-arrow:<color>]` class.
   */
  arrow?: boolean
  /** Keyboard shortcut shown as keycaps after the label ("Ctrl+K" or ["Ctrl", "K"]). */
  shortcut?: string | readonly string[]
  /** Secondary, muted line under the label. */
  description?: React.ReactNode
}) {
  const customBg = arbitraryVarColor(className, "bg")
  const customBorder = arbitraryVarColor(className, "border")
  const hasOtherBg = typeof className === "string" && /(^|\s)bg-/.test(className)
  const showArrow = arrow ?? (!hasOtherBg || customBg !== null)
  const arrowStyle =
    customBg || customBorder
      ? ({
          ...(customBg ? { "--tooltip-arrow": customBg } : null),
          ...(customBorder ? { "--tooltip-arrow-border": customBorder } : null),
        } as React.CSSProperties)
      : null
  const hasExtras = shortcut !== undefined || description !== undefined

  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          "animate-in fade-in-0 zoom-in-[0.96] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.96] data-[side=bottom]:slide-in-from-top-0.5 data-[side=left]:slide-in-from-right-0.5 data-[side=right]:slide-in-from-left-0.5 data-[side=top]:slide-in-from-bottom-0.5 z-50 w-fit origin-(--radix-tooltip-content-transform-origin) text-balance break-words select-none",
          TOOLTIP_VARIANTS[variant],
          className
        )}
        style={arrowStyle ? { ...arrowStyle, ...style } : style}
        {...props}
      >
        {hasExtras ? (
          <span className="tooltip-body">
            <span className="tooltip-label-row">
              <span className="tooltip-label">{children}</span>
              {shortcut !== undefined && <TooltipShortcut keys={shortcut} />}
            </span>
            {description !== undefined && <span className="tooltip-secondary">{description}</span>}
          </span>
        ) : (
          children
        )}
        {showArrow && (
          <TooltipPrimitive.Arrow width={12} height={6} asChild>
            <svg className="tooltip-arrow" aria-hidden="true">
              <polygon points="0,0 30,0 15,10" className="tooltip-arrow-fill" />
              <polyline points="0,0 15,10 30,0" className="tooltip-arrow-edge" vectorEffect="non-scaling-stroke" />
            </svg>
          </TooltipPrimitive.Arrow>
        )}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, TooltipShortcut }
