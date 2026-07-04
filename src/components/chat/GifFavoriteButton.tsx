"use client";

import { Star } from "lucide-react";
import { useGifFavorites } from "@/hooks/useGifFavorites";
import { cn } from "@/lib/utils";

interface GifFavoriteButtonProps {
  url: string;
  title?: string;
  source?: string;
  className?: string;
}

export function GifFavoriteButton({ url, title, source, className }: GifFavoriteButtonProps) {
  const { isFavorite, toggleFavorite } = useGifFavorites();
  const favorite = isFavorite(url);

  if (!url) return null;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleFavorite({ url, title, source });
      }}
      title={favorite ? "Remove from favorites" : "Add to favorites"}
      className={cn(
        "p-1.5 rounded-full bg-black/60 hover:bg-black/80 text-white backdrop-blur-sm transition-all",
        favorite ? "text-yellow-400" : "text-white/80 hover:text-yellow-300",
        className
      )}
    >
      <Star className="w-4 h-4" fill={favorite ? "currentColor" : "none"} />
    </button>
  );
}
