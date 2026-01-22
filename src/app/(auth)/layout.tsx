export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#5865F2] dark:bg-[#5865F2]">
      <div 
        className="absolute inset-0 bg-cover bg-center opacity-10"
        style={{
          backgroundImage: "url('/auth-bg.svg')",
        }}
      />
      <div className="relative z-10 w-full max-w-md mx-4">
        {children}
      </div>
    </div>
  );
}
