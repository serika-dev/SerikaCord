"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft, Settings, Menu, MoreVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGT } from "gt-next";

interface MobileHeaderProps {
    title: string;
    subtitle?: string;
    showBackButton?: boolean;
    backHref?: string;
    onBack?: () => void;
    showSettings?: boolean;
    onSettingsClick?: () => void;
    showMenu?: boolean;
    onMenuClick?: () => void;
    rightAction?: React.ReactNode;
    className?: string;
}

export function MobileHeader({
    title,
    subtitle,
    showBackButton = false,
    backHref,
    onBack,
    showSettings = false,
    onSettingsClick,
    showMenu = false,
    onMenuClick,
    rightAction,
    className,
}: MobileHeaderProps) {
    const router = useRouter();
    const gt = useGT();

    const handleBack = () => {
        if (onBack) {
            onBack();
        } else if (backHref) {
            router.push(backHref);
        } else {
            router.back();
        }
    };

    return (
        <header
            className={cn(
                "flex items-center justify-between px-4 h-14 bg-[var(--bg-app)]/95 backdrop-blur-lg border-b border-[var(--border-subtle)] flex-shrink-0 safe-area-top",
                className
            )}
        >
            <div className="flex items-center gap-3 min-w-0 flex-1">
                {showMenu && (
                    <button
                        onClick={onMenuClick}
                        className="p-2 -ml-2 rounded-xl hover:bg-[var(--bg-hover)] active:bg-[var(--bg-active)] transition-colors mobile-touch-target"
                        aria-label={gt("Open menu")}
                    >
                        <Menu className="w-5 h-5 text-[var(--text-primary)]" />
                    </button>
                )}

                {showBackButton && (
                    <button
                        onClick={handleBack}
                        className="p-2 -ml-2 rounded-xl hover:bg-[var(--bg-hover)] active:bg-[var(--bg-active)] transition-colors mobile-touch-target"
                        aria-label={gt("Go back")}
                    >
                        <ChevronLeft className="w-5 h-5 text-[var(--text-primary)]" />
                    </button>
                )}

                <div className="min-w-0 flex-1">
                    <h1 className="text-lg font-bold text-[var(--text-primary)] truncate leading-tight">
                        {title}
                    </h1>
                    {subtitle && (
                        <p className="text-xs text-[var(--text-muted)] truncate">{subtitle}</p>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-1">
                {rightAction}

                {showSettings && (
                    <button
                        onClick={onSettingsClick}
                        className="p-2.5 rounded-xl hover:bg-[var(--bg-hover)] active:bg-[var(--bg-active)] transition-colors mobile-touch-target"
                        aria-label={gt("Settings")}
                    >
                        <Settings className="w-5 h-5 text-[var(--text-muted)]" />
                    </button>
                )}
            </div>
        </header>
    );
}
