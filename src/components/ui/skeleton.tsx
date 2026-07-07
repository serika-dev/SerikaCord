"use client";

import { cn } from "@/lib/utils";

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "circular" | "rounded";
  animate?: boolean;
}

export function Skeleton({ 
  className, 
  variant = "default", 
  animate = true,
  ...props 
}: SkeletonProps) {
  return (
    <div
      className={cn(
        "bg-[#1a1a1a]",
        animate && "animate-pulse",
        variant === "circular" && "rounded-full",
        variant === "rounded" && "rounded-lg",
        variant === "default" && "rounded-md",
        className
      )}
      {...props}
    />
  );
}

// Server sidebar skeleton
export function ServerSidebarSkeleton() {
  return (
    <div className="flex flex-col items-center w-[72px] h-full bg-[#0a0a0a] py-3 gap-2 border-r border-[#1a1a1a] animate-in fade-in duration-300">
      {/* Home button skeleton */}
      <Skeleton className="w-12 h-12 rounded-[16px]" />
      
      <div className="w-8 h-0.5 bg-[#222222] rounded-full" />
      
      {/* Server list skeleton */}
      <div className="flex-1 w-full flex flex-col items-center gap-2">
        {[...Array(5)].map((_, i) => (
          <Skeleton 
            key={i} 
            className="w-12 h-12 rounded-[24px]" 
            style={{ animationDelay: `${i * 100}ms` }}
          />
        ))}
      </div>
      
      <div className="w-8 h-0.5 bg-[#222222] rounded-full" />
      
      {/* Bottom buttons skeleton */}
      <Skeleton className="w-12 h-12 rounded-[24px]" />
      <Skeleton className="w-12 h-12 rounded-[24px]" />
    </div>
  );
}

// Channel sidebar skeleton
export function ChannelSidebarSkeleton() {
  return (
    <div className="flex flex-col w-60 h-full bg-[#0a0a0a] border-r border-[#1a1a1a] animate-in fade-in duration-300">
      {/* Header skeleton */}
      <div className="h-12 px-4 flex items-center border-b border-[#1a1a1a]">
        <Skeleton className="h-5 w-32" />
      </div>
      
      {/* Channel list skeleton */}
      <div className="flex-1 py-3 px-2 space-y-4 overflow-hidden">
        {/* Category */}
        {[...Array(3)].map((_, categoryIndex) => (
          <div key={categoryIndex} className="space-y-1" style={{ animationDelay: `${categoryIndex * 150}ms` }}>
            <Skeleton className="h-3 w-24 mx-2 mb-2" />
            {[...Array(3)].map((_, channelIndex) => (
              <div 
                key={channelIndex} 
                className="flex items-center gap-2 px-2 py-1.5"
                style={{ animationDelay: `${(categoryIndex * 3 + channelIndex) * 50}ms` }}
              >
                <Skeleton className="w-5 h-5 rounded" />
                <Skeleton className="h-4 flex-1" />
              </div>
            ))}
          </div>
        ))}
      </div>
      
      {/* User panel skeleton */}
      <div className="h-[52px] px-2 flex items-center bg-[#0a0a0a] border-t border-[#1a1a1a]">
        <div className="flex items-center gap-2 flex-1">
          <Skeleton className="w-8 h-8 rounded-full" variant="circular" />
          <div className="flex-1 space-y-1">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-2.5 w-16" />
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Skeleton className="w-8 h-8 rounded" />
          <Skeleton className="w-8 h-8 rounded" />
          <Skeleton className="w-8 h-8 rounded" />
        </div>
      </div>
    </div>
  );
}

// DM sidebar skeleton
export function DMSidebarSkeleton() {
  return (
    <div className="flex flex-col w-60 h-full bg-[#0a0a0a] border-r border-[#1a1a1a] animate-in fade-in duration-300">
      {/* Search skeleton */}
      <div className="h-12 px-4 flex items-center border-b border-[#1a1a1a]">
        <Skeleton className="h-7 w-full rounded" />
      </div>
      
      {/* Navigation skeleton */}
      <div className="px-2 pt-3 pb-1">
        <Skeleton className="h-9 w-full rounded-md" />
      </div>
      
      {/* DM list skeleton */}
      <div className="flex-1 px-2 py-2 space-y-1 overflow-hidden">
        <Skeleton className="h-3 w-28 mx-2 mb-3" />
        {[...Array(8)].map((_, i) => (
          <div 
            key={i} 
            className="flex items-center gap-3 px-2 py-1.5"
            style={{ animationDelay: `${i * 75}ms` }}
          >
            <Skeleton className="w-8 h-8 rounded-full flex-shrink-0" variant="circular" />
            <Skeleton className="h-4 flex-1" />
          </div>
        ))}
      </div>
      
      {/* User panel skeleton */}
      <div className="h-[52px] px-2 flex items-center bg-[#0a0a0a] border-t border-[#1a1a1a]">
        <div className="flex items-center gap-2 flex-1">
          <Skeleton className="w-8 h-8 rounded-full" variant="circular" />
          <div className="flex-1 space-y-1">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-2.5 w-16" />
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Skeleton className="w-8 h-8 rounded" />
          <Skeleton className="w-8 h-8 rounded" />
          <Skeleton className="w-8 h-8 rounded" />
        </div>
      </div>
    </div>
  );
}

// Chat area skeleton
export function ChatAreaSkeleton() {
  return (
    <div className="flex-1 flex flex-col bg-[#0a0a0a] animate-in fade-in duration-300">
      {/* Header skeleton */}
      <div className="h-12 px-4 flex items-center border-b border-[#1a1a1a]">
        <div className="w-6 h-6 rounded mr-2 skeleton-shimmer" />
        <div className="h-5 w-32 rounded skeleton-shimmer" />
        <div className="ml-auto flex items-center gap-2">
          <div className="w-6 h-6 rounded skeleton-shimmer" />
          <div className="w-6 h-6 rounded skeleton-shimmer" />
          <div className="w-6 h-6 rounded skeleton-shimmer" />
        </div>
      </div>
      
      {/* Messages skeleton */}
      <div className="flex-1 p-4 space-y-6 overflow-hidden">
        {SKELETON_GROUPS.map((group, groupIndex) => (
          <div 
            key={groupIndex} 
            className="flex gap-4"
            style={{ animationDelay: `${groupIndex * 100}ms` }}
          >
            <div className="w-10 h-10 rounded-full flex-shrink-0 skeleton-shimmer" />
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <div className="h-4 rounded skeleton-shimmer" style={{ width: `${group.nameW}%` }} />
                <div className="h-3 rounded skeleton-shimmer" style={{ width: `${group.timeW}%` }} />
              </div>
              {group.lines.map((line, msgIndex) => (
                <div 
                  key={msgIndex} 
                  className="h-4 rounded skeleton-shimmer"
                  style={{ width: `${line.w}%` }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      
      {/* Input skeleton */}
      <div className="p-4">
        <div className="h-11 w-full rounded-lg skeleton-shimmer" />
      </div>
    </div>
  );
}

// Message skeleton for inline loading — deterministic widths, shimmer effect
const SKELETON_GROUPS = [
  { nameW: 28, timeW: 12, lines: [{ w: 45 }, { w: 68 }] },
  { nameW: 22, timeW: 10, lines: [{ w: 55 }, { w: 38 }, { w: 62 }] },
  { nameW: 32, timeW: 14, lines: [{ w: 72 }] },
  { nameW: 26, timeW: 11, lines: [{ w: 48 }, { w: 58 }] },
  { nameW: 30, timeW: 13, lines: [{ w: 65 }, { w: 42 }] },
];

export function MessageSkeleton({ count = 5 }: { count?: number }) {
  const groups = SKELETON_GROUPS.slice(0, count);
  return (
    <div className="space-y-1 px-4 py-4">
      {groups.map((group, i) => (
        <div
          key={i}
          className="flex gap-4 py-2"
          style={{ animationDelay: `${i * 60}ms` }}
        >
          <div className="w-10 h-10 rounded-full flex-shrink-0 skeleton-shimmer" />
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <div
                className="h-4 rounded skeleton-shimmer"
                style={{ width: `${group.nameW}%` }}
              />
              <div
                className="h-3 rounded skeleton-shimmer"
                style={{ width: `${group.timeW}%` }}
              />
            </div>
            {group.lines.map((line, j) => (
              <div
                key={j}
                className="h-4 rounded skeleton-shimmer"
                style={{ width: `${line.w}%` }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// User profile skeleton
export function UserProfileSkeleton() {
  return (
    <div className="flex flex-col h-full bg-[#0c0c10] animate-in fade-in slide-in-from-right-2 duration-300 overflow-hidden">
      {/* Banner */}
      <Skeleton className="h-[120px] rounded-none shrink-0" />

      {/* Profile section */}
      <div className="relative flex-1 flex flex-col min-h-0 px-4 pb-4">
        <div className="absolute -top-11 left-4">
          <Skeleton className="w-[88px] h-[88px] rounded-full border-[5px] border-[#0c0c10]" variant="circular" />
        </div>

        <div className="flex justify-end gap-2 pt-3 min-h-[44px]">
          <Skeleton className="h-9 w-24 rounded-lg" />
          <Skeleton className="h-9 w-9 rounded-lg" />
        </div>

        <div className="mt-4 space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-20" />
        </div>

        <div className="mt-4 space-y-3">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>

        <Skeleton className="mt-auto h-10 w-full rounded-lg" />
      </div>
    </div>
  );
}

// Member sidebar skeleton
export function MemberSidebarSkeleton() {
  return (
    <div className="w-60 bg-[#0a0a0a] border-l border-[#1a1a1a] animate-in fade-in slide-in-from-right-2 duration-300">
      <div className="p-4 space-y-4">
        {[...Array(3)].map((_, groupIndex) => (
          <div key={groupIndex} className="space-y-2">
            <Skeleton className="h-3 w-16" />
            {[...Array(4)].map((_, memberIndex) => (
              <div 
                key={memberIndex} 
                className="flex items-center gap-2 py-1"
                style={{ animationDelay: `${(groupIndex * 4 + memberIndex) * 50}ms` }}
              >
                <Skeleton className="w-8 h-8 rounded-full" variant="circular" />
                <Skeleton className="h-4 flex-1" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
