import Link from "next/link";
import { T } from "gt-next";
import { getGT } from "gt-next/server";
import { LocaleSelector } from "@/components/ui/LocaleSelector";
import { Logo } from "@/components/ui/Logo";
import { PartnerSection } from "@/components/home/PartnerSection";
import { HomeNavActions, HomeHeroActions } from "@/components/home/HomeNav";
import { buildMetadata } from "@/lib/seo";
import { 
  MessageSquare,
  Users, 
  Shield, 
  ArrowRight,
  Volume2,
  Megaphone,
  Zap,
} from "lucide-react";

export const metadata = buildMetadata({
  title: "SerikaCord",
  description: "A modern Discord-like chat application",
  path: "/",
  keywords: [
    "SerikaCord",
    "Discord alternative",
    "community chat",
    "voice chat",
    "messaging app",
    "group chat",
    "online communities",
    "free chat platform",
  ],
});

export default async function HomePage() {
  const gt = await getGT();
  const navLinks = [
    { label: gt("Features"), href: "#features" },
    { label: gt("Discover"), href: "#discover" },
    { label: gt("Safety"), href: "#safety" },
  ];
  const features = [
    {
      icon: MessageSquare,
      title: gt("Text Channels"),
      description: gt("Organize conversations into dedicated channels for different topics, teams, or interests."),
    },
    {
      icon: Volume2,
      title: gt("Voice Channels"),
      description: gt("Drop in when free, hang out and talk with friends and community members using P2P voice."),
    },
    {
      icon: Megaphone,
      title: gt("Announcements"),
      description: gt("Share important updates with your community. Members can follow to get updates in their own servers."),
    },
    {
      icon: Users,
      title: gt("Community Features"),
      description: gt("Welcome screens, rules, server discovery, and more tools for growing communities."),
    },
    {
      icon: Shield,
      title: gt("Moderation"),
      description: gt("Powerful moderation tools and permission systems to keep your community safe."),
    },
    {
      icon: Zap,
      title: gt("Fast & Reliable"),
      description: gt("Built for speed with real-time message delivery and reliable connections."),
    }
  ];
  const safetyItems = [
    { title: gt("End-to-End Privacy"), description: gt("Your data stays yours. We don't sell your information.") },
    { title: gt("Powerful Moderation"), description: gt("Tools to keep your community safe and welcoming.") },
    { title: gt("You're in Control"), description: gt("Manage who can contact you and how.") },
  ];
  return (
    <div className="min-h-screen bg-[#000000] text-white overflow-x-hidden">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#000]/70 backdrop-blur-2xl border-b border-white/[0.05]">
        <div className="max-w-7xl mx-auto px-6 lg:px-10">
          <div className="flex items-center justify-between h-[60px]">
            {/* Logo */}
            <Link href="/" className="shrink-0">
              <Logo size="sm" />
            </Link>
            
            {/* Center links */}
            <div className="hidden md:flex items-center gap-1">
              {navLinks.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="px-3 py-1.5 text-sm text-[#999] hover:text-white rounded-lg hover:bg-white/5 transition-all"
                >
                  {item.label}
                </Link>
              ))}
            </div>
            
            {/* Right actions */}
            <div className="flex items-center gap-3">
              <HomeNavActions />
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative min-h-screen flex flex-col items-center justify-center px-6 text-center overflow-hidden">
        {/* Background */}
        <div className="absolute inset-0 pointer-events-none">
          {/* Deep radial glow — left */}
          <div className="absolute -top-40 -left-60 w-[700px] h-[700px] rounded-full bg-[#4c1d95]/30 blur-[140px]" />
          {/* Deep radial glow — right */}
          <div className="absolute -bottom-20 -right-60 w-[700px] h-[600px] rounded-full bg-[#312e81]/25 blur-[140px]" />
          {/* Subtle center glow */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full bg-[#8B5CF6]/8 blur-[100px]" />
        </div>

        <div className="relative max-w-4xl mx-auto">
          <h1 className="text-5xl sm:text-6xl md:text-[82px] font-extrabold tracking-tight leading-[1.04] mb-7">
            <span className="text-white">{gt("Your place to")} </span>
            <br className="hidden sm:block" />
            <span style={{
              background: 'linear-gradient(135deg, #a78bfa 0%, #8B5CF6 50%, #6d28d9 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text'
            }}>
              {gt("talk & hang out")}
            </span>
          </h1>

          <p className="text-lg sm:text-xl text-[#888] max-w-xl mx-auto mb-12 leading-relaxed font-medium">
            {gt("SerikaCord is where communities come together. Talk, build, and belong — all in one place.")}
          </p>

          <HomeHeroActions />
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <T>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Everything you need</h2>
            <p className="text-lg text-[#666666] max-w-2xl mx-auto">
              From casual conversations to large community hubs, SerikaCord has all the tools to bring people together.
            </p>
            </T>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature) => (
              <div 
                key={feature.title}
                className="group relative p-6 rounded-2xl bg-[#080a0f] border border-white/[0.06] hover:border-[#8B5CF6]/25 hover:bg-[#0d0f1a] transition-all duration-200"
              >
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-[#8B5CF6]/0 to-[#8B5CF6]/0 group-hover:from-[#8B5CF6]/5 group-hover:to-transparent transition-all duration-300" />
                <div className="relative">
                  <div className="w-11 h-11 rounded-xl bg-[#8B5CF6]/10 border border-[#8B5CF6]/20 flex items-center justify-center mb-4">
                    <feature.icon className="w-5 h-5 text-[#8B5CF6]" />
                  </div>
                  <h3 className="text-base font-semibold mb-2">{feature.title}</h3>
                  <p className="text-sm text-[#555555] leading-relaxed group-hover:text-[#777] transition-colors">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Partnered Servers Section */}
      <PartnerSection />

      {/* Safety Section */}
      <section id="safety" className="py-24 px-4 sm:px-6 lg:px-8 bg-[#0a0a0a]">
        <div className="max-w-5xl mx-auto text-center">
          <Shield className="w-12 h-12 mx-auto mb-6 text-[#8B5CF6]" />
          <T>
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">Your Safety Matters</h2>
          <p className="text-lg text-[#666666] max-w-2xl mx-auto mb-12">
            We take safety seriously. SerikaCord is built with privacy and security in mind, 
            giving you control over your experience.
          </p>
          </T>
          
          <div className="grid sm:grid-cols-3 gap-6">
            {safetyItems.map((item) => (
              <div key={item.title} className="p-6 rounded-lg bg-[#111111] border border-[#1a1a1a]">
                <h3 className="font-semibold mb-2">{item.title}</h3>
                <p className="text-sm text-[#666666]">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full bg-[#8B5CF6]/8 blur-[100px]" />
        </div>
        <div className="max-w-4xl mx-auto text-center relative">
          <T>
          <h2 className="text-3xl sm:text-5xl font-bold mb-4 tracking-tight">Ready to get started?</h2>
          <p className="text-lg text-[#555555] mb-10">
            Join thousands of communities already using SerikaCord. It&apos;s free.
          </p>
          </T>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link 
              href="/channels/me"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-10 py-4 text-base font-semibold bg-[#8B5CF6] hover:bg-[#7C3AED] rounded-xl transition-all hover:scale-[1.02] active:scale-[0.98] shadow-[0_0_40px_rgba(139,92,246,0.25)]"
            >
              <T>Open SerikaCord</T>
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/register"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-10 py-4 text-base font-semibold border border-white/10 hover:border-white/20 rounded-xl transition-all hover:scale-[1.02] active:scale-[0.98] text-[#888]"
            >
              <T>Create Account</T>
            </Link>
          </div>
          <p className="text-xs text-[#333] mt-6"><T>Free and open source · Forever</T></p>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-16 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-10 mb-14">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-widest text-[#555] mb-4"><T>Product</T></h4>
              <ul className="space-y-3 text-sm text-[#666]">
                <li><Link href="/download" className="hover:text-white transition-colors"><T>Download</T></Link></li>
                <li><Link href="https://status.serika.dev" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors"><T>Status</T></Link></li>
                <li><Link href="/channels/me" className="hover:text-white transition-colors"><T>Open App</T></Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-widest text-[#555] mb-4"><T>Company</T></h4>
              <ul className="space-y-3 text-sm text-[#666]">
                <li><Link href="https://serika.pro" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors"><T>About Serika</T></Link></li>
                <li><Link href="https://accounts.serika.dev" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors"><T>Serika Accounts</T></Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-widest text-[#555] mb-4"><T>Resources</T></h4>
              <ul className="space-y-3 text-sm text-[#666]">
                <li><a href="mailto:support@serika.dev" className="hover:text-white transition-colors"><T>Support</T></a></li>
                <li><Link href="#safety" className="hover:text-white transition-colors"><T>Safety</T></Link></li>
                <li><Link href="https://status.serika.dev" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors"><T>Service Status</T></Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-widest text-[#555] mb-4"><T>Legal</T></h4>
              <ul className="space-y-3 text-sm text-[#666]">
                <li><Link href="/terms" className="hover:text-white transition-colors"><T>Terms of Service</T></Link></li>
                <li><Link href="/privacy" className="hover:text-white transition-colors"><T>Privacy Policy</T></Link></li>
                <li><Link href="/guidelines" className="hover:text-white transition-colors"><T>Community Guidelines</T></Link></li>
              </ul>
            </div>
          </div>
          
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6 pt-8 border-t border-white/[0.06]">
            <Link href="/" className="mb-4 sm:mb-0">
              <Logo size="sm" />
            </Link>
            <div className="flex items-center gap-6">
              <LocaleSelector className="w-[180px] h-9" />
              <p className="text-xs text-[#444]">
                <T>© 2026 Serika Company. All rights reserved.</T>
              </p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
