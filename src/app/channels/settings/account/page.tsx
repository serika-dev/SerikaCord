"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, User, Mail, Shield } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function AccountSettingsPage() {
    const router = useRouter();
    const { user } = useAuth();

    return (
        <div className="flex flex-col h-full bg-[#000000]">
            {/* Header */}
            <div className="flex items-center gap-4 px-4 py-4 bg-[#0a0a0a] border-b border-white/5 safe-area-top">
                <button
                    onClick={() => router.back()}
                    className="p-2 -ml-2 rounded-full hover:bg-white/10 text-white transition-colors"
                >
                    <ArrowLeft className="w-6 h-6" />
                </button>
                <h1 className="text-xl font-bold text-white">My Account</h1>
            </div>

            <ScrollArea className="flex-1">
                <div className="p-4 space-y-6">
                    {/* Profile Banner Card */}
                    <div className="rounded-2xl bg-[#111111] overflow-hidden border border-white/5">
                        <div className={`h-24 ${user?.banner ? 'bg-cover bg-center' : 'bg-gradient-to-r from-[#8B5CF6] to-[#6366F1]'}`}
                            style={user?.banner ? { backgroundImage: `url(${user.banner})` } : undefined}
                        />
                        <div className="px-5 pb-5 relative">
                            <div className="absolute -top-10 left-5">
                                <Avatar className="w-20 h-20 border-[6px] border-[#111111]">
                                    <AvatarImage src={user?.avatar} />
                                    <AvatarFallback className="bg-[#8B5CF6] text-white text-2xl font-bold">
                                        {(user?.displayName || user?.username || "U").charAt(0).toUpperCase()}
                                    </AvatarFallback>
                                </Avatar>
                            </div>
                            <div className="mt-12">
                                <h2 className="text-xl font-bold text-white">{user?.displayName || user?.username}</h2>
                                <p className="text-neutral-400">@{user?.username}</p>
                            </div>
                        </div>
                    </div>

                    {/* Info Fields */}
                    <div className="space-y-4">
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-neutral-500 uppercase">Display Name</label>
                            <div className="p-4 rounded-xl bg-[#111111] border border-white/5 text-white flex items-center justify-between">
                                <span>{user?.displayName || user?.username}</span>
                                <button className="text-sm font-medium text-[#8B5CF6]">Edit</button>
                            </div>
                        </div>

                        <div className="space-y-1">
                            <label className="text-xs font-bold text-neutral-500 uppercase">Username</label>
                            <div className="p-4 rounded-xl bg-[#111111] border border-white/5 text-white flex items-center justify-between">
                                <span>{user?.username}</span>
                                <button className="text-sm font-medium text-[#8B5CF6]">Edit</button>
                            </div>
                        </div>

                        <div className="space-y-1">
                            <label className="text-xs font-bold text-neutral-500 uppercase">Email</label>
                            <div className="p-4 rounded-xl bg-[#111111] border border-white/5 text-white flex items-center justify-between">
                                <span>{user?.email || "No email linked"}</span>
                                <button className="text-sm font-medium text-[#8B5CF6]">Edit</button>
                            </div>
                        </div>

                        <div className="space-y-1">
                            <label className="text-xs font-bold text-neutral-500 uppercase">About Me</label>
                            <div className="p-4 rounded-xl bg-[#111111] border border-white/5 text-white min-h-[100px]">
                                {user?.bio || "No bio set."}
                            </div>
                        </div>
                    </div>
                </div>
            </ScrollArea>
        </div>
    );
}
