import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-dvh bg-[#05060a] flex flex-col items-center justify-center px-4 text-center">
      <p className="text-8xl font-extrabold text-white/5 select-none mb-6">404</p>
      <h1 className="text-2xl font-bold text-white mb-2">Page Not Found</h1>
      <p className="text-[#8d97ad] text-sm mb-8">
        This page doesn&apos;t exist or you don&apos;t have access to it.
      </p>
      <Link
        href="/"
        className="px-6 py-3 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-medium rounded-lg transition-colors text-sm"
      >
        Go Home
      </Link>
    </div>
  );
}
