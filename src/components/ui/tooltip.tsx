"use client"

import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/lib/utils"

/**
 * Set by TooltipProvider so a Tooltip inside one joins its delay group (the
 * first tooltip waits `delayDuration`, moving to a neighbour within
 * `skipDelayDuration` opens it instantly) instead of creating its own
 * provider. A Tooltip outside any provider still works on its own.
 */
const TooltipGroupContext = React.createContext(false)

function TooltipProvider({
  delayDuration = 0,
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
  /** Small dark label chip (Discord style). */
  default:
    "max-w-[min(280px,calc(100vw-1.5rem))] rounded-lg border border-[var(--tooltip-border)] bg-[var(--tooltip-bg)] px-2.5 py-1.5 text-xs font-medium leading-snug text-[var(--tooltip-fg)] shadow-[var(--tooltip-shadow)] [--tooltip-arrow:var(--tooltip-bg)]",
  /** Rich content (title, description, icons) on the app's card surface. */
  card:
    "max-w-[min(320px,calc(100vw-1.5rem))] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3 text-sm text-[var(--text-primary)] shadow-[var(--app-elev-2)] [--tooltip-arrow:var(--bg-card)]",
} as const

function TooltipContent({
  className,
  sideOffset = 6,
  variant = "default",
  arrow,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content> & {
  variant?: keyof typeof TOOLTIP_VARIANTS
  /**
   * Show the pointer arrow. Defaults to on, except when the caller paints its
   * own surface with a `bg-*` class (the arrow could not match it); pass
   * `arrow` explicitly together with a `[--tooltip-arrow:<color>]` class to
   * colour it for a custom surface.
   */
  arrow?: boolean
}) {
  const showArrow = arrow ?? !(typeof className === "string" && /(^|\s)bg-/.test(className))
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 z-50 w-fit origin-(--radix-tooltip-content-transform-origin) text-balance break-words select-none",
          TOOLTIP_VARIANTS[variant],
          className
        )}
        {...props}
      >
        {children}
        {showArrow && (
          <TooltipPrimitive.Arrow
            width={10}
            height={5}
            className="fill-[var(--tooltip-arrow)] drop-shadow-[0_1px_0_var(--tooltip-border)]"
          />
        )}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
