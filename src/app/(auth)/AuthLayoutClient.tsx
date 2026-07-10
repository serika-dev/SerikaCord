"use client";

import { motion } from "framer-motion";
import { MessageSquare } from "lucide-react";
import Link from "next/link";
import { T } from "gt-next";

export default function AuthLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#000000] overflow-hidden">
      {/* Radial glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] rounded-full bg-[#8B5CF6]/8 blur-[120px] pointer-events-none" />
      {/* Subtle grid pattern */}
      <div 
        className="absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(139, 92, 246, 0.8) 1px, transparent 1px),
            linear-gradient(90deg, rgba(139, 92, 246, 0.8) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px'
        }}
      />

      {/* Logo */}
      <motion.div 
        className="absolute top-8 left-8 z-20"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-10 h-10 rounded-xl bg-[#8B5CF6] flex items-center justify-center">
            <MessageSquare className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-semibold text-white"><T>SerikaCord</T></span>
        </Link>
      </motion.div>

      {/* Main content */}
      <motion.div 
        className="relative z-10 w-full max-w-md mx-4"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {children}
      </motion.div>

      {/* Footer */}
      <div className="absolute bottom-6 text-center w-full z-20">
        <p className="text-xs text-[#666666]">
          <T>© 2026 SerikaCord. All rights reserved.</T>
        </p>
      </div>
    </div>
  );
}
