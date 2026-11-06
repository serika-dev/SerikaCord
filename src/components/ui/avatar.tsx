"use client"

import * as React from "react"

import { cdnImageFallback, cn } from "@/lib/utils"

// Avatars are on every list row and message, often 100+ on screen. Radix's
// Avatar tracked each image's load in React state: a state update per avatar
// during the mounting commit, then one more render + commit per image as it
// loaded. These render once: the image sits over the fallback and covers it
// when it paints; load/error only touch the DOM (an error that needs the
// original-format retry is the only re-render).

function Avatar({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="avatar"
      className={cn(
        // A loaded image hides the fallback (transparent avatars). `isolate`
        // keeps the image's z-index inside the avatar, so status badges and
        // other overlays drawn next to it stay on top.
        "relative isolate flex size-8 shrink-0 overflow-hidden rounded-full [&:has(>[data-loaded])>[data-slot=avatar-fallback]]:invisible",
        className
      )}
      {...props}
    />
  )
}

type AvatarImageProps = Omit<React.ComponentProps<"img">, "src"> & {
  src?: string | null
}

function AvatarImage({ src, ...props }: AvatarImageProps) {
  // A new avatar starts with its optimized source, even if the previous
  // person's image needed the original-format retry.
  if (!src) return null
  return <AvatarImageSource key={src} src={src} {...props} />
}

function AvatarImageSource({
  src,
  className,
  alt = "",
  onLoad,
  onError,
  ...props
}: AvatarImageProps & { src: string }) {
  const [attempt, setAttempt] = React.useState<"optimized" | "original" | "failed">("optimized")
  const originalSrc = cdnImageFallback(src)
  if (attempt === "failed") return null
  const imageSrc = attempt === "original" && originalSrc ? originalSrc : src

  return (
    // eslint-disable-next-line @next/next/no-img-element -- CDN avatars (cdnImage), not next/image
    <img
      key={attempt}
      data-slot="avatar-image"
      alt={alt}
      className={cn("absolute inset-0 z-[1] block aspect-square size-full shrink-0 object-cover", className)}
      {...props}
      src={imageSrc}
      onLoad={(e) => {
        // Hides the fallback under images with transparent areas (see Avatar).
        e.currentTarget.setAttribute("data-loaded", "")
        onLoad?.(e)
      }}
      onError={(e) => {
        // Never show a broken image (or its alt text), even for one frame.
        e.currentTarget.style.visibility = "hidden"
        setAttempt(attempt === "optimized" && originalSrc ? "original" : "failed")
        onError?.(e)
      }}
    />
  )
}

function AvatarFallback({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="avatar-fallback"
      className={cn(
        "bg-muted flex size-full items-center justify-center rounded-full [[data-loaded]~&]:invisible",
        className
      )}
      {...props}
    />
  )
}

/**
 * Overlapping avatars (shadcn's AvatarGroup). Direct Avatar children get a
 * ring in the surface colour so each one looks cut out of the next; set
 * `--avatar-group-ring` to the colour behind the group.
 */
function AvatarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group"
      className={cn(
        "flex items-center -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-[var(--avatar-group-ring,var(--app-bg-solid))]",
        className
      )}
      {...props}
    />
  )
}

/** The "+N" bubble at the end of an AvatarGroup. */
function AvatarGroupCount({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group-count"
      className={cn(
        "relative flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--app-surface)] text-xs font-medium text-[var(--app-muted)] ring-2 ring-[var(--avatar-group-ring,var(--app-bg-solid))]",
        className
      )}
      {...props}
    />
  )
}

export { Avatar, AvatarImage, AvatarFallback, AvatarGroup, AvatarGroupCount }
