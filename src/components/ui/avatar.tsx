"use client"

import * as React from "react"
import * as AvatarPrimitive from "@radix-ui/react-avatar"

import { cdnImageFallback, cn } from "@/lib/utils"

function Avatar({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root>) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn(
        "relative flex size-8 shrink-0 overflow-hidden rounded-full",
        className
      )}
      {...props}
    />
  )
}

type AvatarImageProps = React.ComponentProps<typeof AvatarPrimitive.Image>

function AvatarImage({ src, ...props }: AvatarImageProps) {
  // A new avatar starts with its optimized source, even if the previous
  // person's image needed the original-format retry.
  return <AvatarImageSource key={typeof src === "string" ? src : undefined} src={src} {...props} />
}

function AvatarImageSource({
  src,
  className,
  onLoadingStatusChange,
  ...props
}: AvatarImageProps) {
  const [retryOriginal, setRetryOriginal] = React.useState(false)
  const originalSrc = cdnImageFallback(typeof src === "string" ? src : undefined)
  const imageSrc = retryOriginal ? originalSrc : src

  return (
    <AvatarPrimitive.Image
      key={retryOriginal ? "original" : "optimized"}
      data-slot="avatar-image"
      className={cn("block aspect-square size-full shrink-0 object-cover", className)}
      {...props}
      src={imageSrc}
      onLoadingStatusChange={(status) => {
        if (status === "error" && originalSrc && !retryOriginal) {
          setRetryOriginal(true)
          onLoadingStatusChange?.("loading")
          return
        }
        onLoadingStatusChange?.(status)
      }}
    />
  )
}

function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "bg-muted flex size-full items-center justify-center rounded-full",
        className
      )}
      {...props}
    />
  )
}

export { Avatar, AvatarImage, AvatarFallback }
