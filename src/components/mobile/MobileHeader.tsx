"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft, Settings, Menu, MoreVertical } from "lucide-react";
import { cn } from "@/lib/utils";

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
                "flex items-center justify-between px-4 h-14 bg-[#0a0a0a]/95 backdrop-blur-lg border-b border-white/5 flex-shrink-0 safe-area-top",
                className
            )}
        >
            <div className="flex items-center gap-3 min-w-0 flex-1">
                {showMenu && (
                    <button
                        onClick={onMenuClick}
                        className="p-2 -ml-2 rounded-xl hover:bg-white/5 active:bg-white/10 transition-colors mobile-touch-target"
                        aria-label="Open menu"
                    >
                        <Menu className="w-5 h-5 text-white" />
                    </button>
                )}

                {showBackButton && (
                    <button
                        onClick={handleBack}
                        className="p-2 -ml-2 rounded-xl hover:bg-white/5 active:bg-white/10 transition-colors mobile-touch-target"
                        aria-label="Go back"
                    >
                        <ChevronLeft className="w-5 h-5 text-white" />
                    </button>
                )}

                <div className="min-w-0 flex-1">
                    <h1 className="text-lg font-bold text-white truncate leading-tight">
                        {title}
                    </h1>
                    {subtitle && (
                        <p className="text-xs text-neutral-400 truncate">{subtitle}</p>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-1">
                {rightAction}

                {showSettings && (
                    <button
                        onClick={onSettingsClick}
                        className="p-2.5 rounded-xl hover:bg-white/5 active:bg-white/10 transition-colors mobile-touch-target"
                        aria-label="Settings"
                    >
                        <Settings className="w-5 h-5 text-neutral-400" />
                    </button>
                )}
            </div>
        </header>
    );
}
