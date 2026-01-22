"use client";

import { Users, MessageSquare, Store, Gamepad2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DirectMessagesPage() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-[#313338] text-[#949ba4]">
      <div className="text-center max-w-md">
        <div className="w-72 h-48 mx-auto mb-8 flex items-center justify-center">
          <div className="relative">
            {/* Decorative circles */}
            <div className="absolute -top-4 -left-8 w-16 h-16 rounded-full bg-[#5865F2]/20 animate-pulse" />
            <div className="absolute top-8 -right-12 w-12 h-12 rounded-full bg-[#23a55a]/20 animate-pulse delay-300" />
            <div className="absolute -bottom-4 left-4 w-10 h-10 rounded-full bg-[#f0b232]/20 animate-pulse delay-500" />
            
            {/* Main icon */}
            <div className="relative w-32 h-32 rounded-full bg-gradient-to-br from-[#5865F2] to-[#eb459e] flex items-center justify-center">
              <Users className="w-16 h-16 text-white" />
            </div>
          </div>
        </div>

        <h2 className="text-xl font-semibold text-white mb-2">
          No one&apos;s around to play with SerikaCord
        </h2>
        <p className="text-[#b5bac1] mb-6">
          When you have any direct messages, they&apos;ll appear here. Start a conversation with friends!
        </p>

        {/* Quick Actions */}
        <div className="flex flex-wrap gap-2 justify-center">
          <Button
            variant="ghost"
            className="bg-[#5865F2] hover:bg-[#4752c4] text-white"
          >
            <MessageSquare className="w-4 h-4 mr-2" />
            Start a Message
          </Button>
          <Button
            variant="ghost"
            className="bg-[#2b2d31] hover:bg-[#35373c] text-[#dbdee1]"
          >
            <Users className="w-4 h-4 mr-2" />
            Find Friends
          </Button>
        </div>
      </div>

      {/* Bottom Navigation */}
      <div className="absolute bottom-0 left-0 right-0 h-14 bg-[#232428] flex items-center justify-around px-4 border-t border-[#1f2023]">
        <button className="flex flex-col items-center gap-1 text-[#5865F2]">
          <MessageSquare className="w-6 h-6" />
          <span className="text-xs">Messages</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-[#949ba4] hover:text-white transition-colors">
          <Store className="w-6 h-6" />
          <span className="text-xs">Nitro</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-[#949ba4] hover:text-white transition-colors">
          <Gamepad2 className="w-6 h-6" />
          <span className="text-xs">Activity</span>
        </button>
      </div>
    </div>
  );
}
