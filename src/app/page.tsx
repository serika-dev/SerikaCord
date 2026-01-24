import Link from "next/link";
import { 
  MessageSquare, 
  Users, 
  Shield, 
  Sparkles, 
  ArrowRight,
  Hash,
  Volume2,
  Megaphone,
  Check,
  Star,
  Zap,
  Globe
} from "lucide-react";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#000000] text-white overflow-x-hidden">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#000000]/90 backdrop-blur-sm border-b border-[#1a1a1a]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-[#8B5CF6] flex items-center justify-center">
                <MessageSquare className="w-5 h-5" />
              </div>
              <span className="text-xl font-bold">SerikaCord</span>
            </div>
            
            <div className="hidden md:flex items-center gap-8">
              <Link href="#features" className="text-sm text-[#888888] hover:text-white transition-colors">
                Features
              </Link>
              <Link href="#discover" className="text-sm text-[#888888] hover:text-white transition-colors">
                Discover
              </Link>
              <Link href="#safety" className="text-sm text-[#888888] hover:text-white transition-colors">
                Safety
              </Link>
              <Link href="https://accounts.serika.dev" className="text-sm text-[#888888] hover:text-white transition-colors">
                Serika+
              </Link>
            </div>
            
            <div className="flex items-center gap-3">
              <Link 
                href="/login"
                className="text-sm font-medium text-white hover:text-[#888888] transition-colors"
              >
                Login
              </Link>
              <Link 
                href="/register"
                className="px-4 py-2 text-sm font-medium bg-[#8B5CF6] hover:bg-[#7C3AED] rounded-md transition-colors"
              >
                Sign Up
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 px-4 sm:px-6 lg:px-8">
        {/* Subtle background grid */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div 
            className="absolute inset-0"
            style={{
              backgroundImage: `
                linear-gradient(rgba(139, 92, 246, 0.03) 1px, transparent 1px),
                linear-gradient(90deg, rgba(139, 92, 246, 0.03) 1px, transparent 1px)
              `,
              backgroundSize: '60px 60px'
            }}
          />
        </div>
        
        <div className="max-w-5xl mx-auto text-center relative">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#8B5CF6]/10 border border-[#8B5CF6]/20 mb-8">
            <Sparkles className="w-4 h-4 text-[#8B5CF6]" />
            <span className="text-sm text-[#888888]">The future of communication is here</span>
          </div>
          
          <h1 className="text-4xl sm:text-5xl md:text-7xl font-bold tracking-tight mb-6">
            <span className="text-white">
              Where Communities
            </span>
            <br />
            <span className="text-[#8B5CF6]">
              Come Together
            </span>
          </h1>
          
          <p className="text-lg sm:text-xl text-[#666666] max-w-2xl mx-auto mb-10 leading-relaxed">
            SerikaCord is the place to talk, hang out, and build communities. 
            Whether you&apos;re a gaming group, study club, or worldwide art community — 
            your space is here.
          </p>
          
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link 
              href="/channels/@me"
              className="w-full sm:w-auto px-8 py-4 text-base font-medium bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-md transition-colors flex items-center justify-center gap-2"
            >
              Open SerikaCord in your browser
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link 
              href="/register"
              className="w-full sm:w-auto px-8 py-4 text-base font-medium bg-transparent border border-[#333333] hover:border-[#8B5CF6] hover:bg-[#8B5CF6]/5 rounded-md transition-colors flex items-center justify-center gap-2"
            >
              Create an Account
            </Link>
          </div>
        </div>
        
        {/* App Preview */}
        <div className="max-w-6xl mx-auto mt-20 relative">
          <div className="aspect-video rounded-lg bg-[#0a0a0a] border border-[#1a1a1a] overflow-hidden">
            <div className="flex h-full">
              {/* Server sidebar preview */}
              <div className="w-[72px] bg-[#0a0a0a] p-3 flex flex-col items-center gap-2 border-r border-[#1a1a1a]">
                <div className="w-12 h-12 rounded-2xl bg-[#8B5CF6] flex items-center justify-center">
                  <MessageSquare className="w-6 h-6" />
                </div>
                <div className="w-8 h-0.5 bg-[#222222] rounded-full" />
                {[1, 2, 3].map((i) => (
                  <div key={i} className="w-12 h-12 rounded-[24px] bg-[#111111] hover:rounded-[16px] transition-all" />
                ))}
              </div>
              
              {/* Channel sidebar preview */}
              <div className="w-60 bg-[#0a0a0a] border-r border-[#1a1a1a]">
                <div className="h-12 px-4 flex items-center border-b border-[#1a1a1a]">
                  <span className="font-semibold text-white">Your Server</span>
                </div>
                <div className="p-2 space-y-1">
                  <div className="px-2 py-1 text-xs font-semibold uppercase text-[#555555]">Text Channels</div>
                  {["general", "announcements", "support"].map((channel, i) => (
                    <div key={channel} className={`flex items-center gap-2 px-2 py-1.5 rounded ${i === 0 ? 'bg-[#8B5CF6]/10 text-[#8B5CF6]' : 'text-[#666666]'}`}>
                      {i === 1 ? <Megaphone className="w-5 h-5" /> : <Hash className="w-5 h-5" />}
                      <span className="text-sm">{channel}</span>
                    </div>
                  ))}
                  <div className="px-2 py-1 text-xs font-semibold uppercase text-[#555555] mt-4">Voice Channels</div>
                  <div className="flex items-center gap-2 px-2 py-1.5 rounded text-[#666666]">
                    <Volume2 className="w-5 h-5" />
                    <span className="text-sm">Lounge</span>
                  </div>
                </div>
              </div>
              
              {/* Chat area preview */}
              <div className="flex-1 bg-[#0a0a0a] flex flex-col">
                <div className="h-12 px-4 flex items-center border-b border-[#1a1a1a]">
                  <Hash className="w-5 h-5 text-[#555555] mr-2" />
                  <span className="font-semibold text-white">general</span>
                </div>
                <div className="flex-1 p-4 space-y-4 overflow-hidden">
                  {[
                    { name: "Alice", avatar: "A", message: "Hey everyone! Welcome to the server! 👋" },
                    { name: "Bob", avatar: "B", message: "Thanks! This place looks amazing" },
                    { name: "Charlie", avatar: "C", message: "Can't wait to start chatting with everyone here" },
                  ].map((msg, i) => (
                    <div key={i} className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-full bg-[#8B5CF6] flex items-center justify-center flex-shrink-0">
                        <span className="text-sm font-medium">{msg.avatar}</span>
                      </div>
                      <div>
                        <div className="flex items-baseline gap-2">
                          <span className="font-medium text-white">{msg.name}</span>
                          <span className="text-xs text-[#555555]">Today at 12:0{i}</span>
                        </div>
                        <p className="text-[#888888]">{msg.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Everything you need</h2>
            <p className="text-lg text-[#666666] max-w-2xl mx-auto">
              From casual conversations to large community hubs, SerikaCord has all the tools to bring people together.
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: MessageSquare,
                title: "Text Channels",
                description: "Organize conversations into dedicated channels for different topics, teams, or interests.",
              },
              {
                icon: Volume2,
                title: "Voice Channels",
                description: "Drop in when free, hang out and talk with friends and community members.",
                comingSoon: true
              },
              {
                icon: Megaphone,
                title: "Announcements",
                description: "Share important updates with your community. Members can follow to get updates in their own servers.",
              },
              {
                icon: Users,
                title: "Community Features",
                description: "Welcome screens, rules, server discovery, and more tools for growing communities.",
              },
              {
                icon: Shield,
                title: "Moderation",
                description: "Powerful moderation tools and permission systems to keep your community safe.",
              },
              {
                icon: Zap,
                title: "Fast & Reliable",
                description: "Built for speed with real-time message delivery and reliable connections.",
              }
            ].map((feature) => (
              <div 
                key={feature.title}
                className="group relative p-6 rounded-lg bg-[#0a0a0a] border border-[#1a1a1a] hover:border-[#8B5CF6]/30 transition-all"
              >
                {feature.comingSoon && (
                  <div className="absolute top-4 right-4 px-2 py-1 rounded-md bg-[#8B5CF6]/10 border border-[#8B5CF6]/20">
                    <span className="text-xs font-medium text-[#8B5CF6]">Coming Soon</span>
                  </div>
                )}
                <div className="w-12 h-12 rounded-lg bg-[#8B5CF6]/10 flex items-center justify-center mb-4">
                  <feature.icon className="w-6 h-6 text-[#8B5CF6]" />
                </div>
                <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
                <p className="text-sm text-[#666666] leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Serika+ Section */}
      <section className="py-24 px-4 sm:px-6 lg:px-8 bg-[#0a0a0a]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#8B5CF6]/10 border border-[#8B5CF6]/20 mb-6">
              <Sparkles className="w-4 h-4 text-[#8B5CF6]" />
              <span className="text-sm text-[#8B5CF6] font-medium">Serika+</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Upgrade Your Experience
            </h2>
            <p className="text-lg text-[#666666] max-w-2xl mx-auto">
              Get the most out of SerikaCord with premium features, higher limits, and exclusive customization options.
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 gap-12 items-start">
            <div className="space-y-4">
              {[
                { title: "100MB File Uploads", description: "Share bigger files with your friends" },
                { title: "Animated Avatars", description: "Express yourself with animated profile pictures" },
                { title: "Profile Customization", description: "Custom colors, banners, and themes" },
                { title: "Longer Messages", description: "Up to 4000 characters per message" },
                { title: "HD Streaming", description: "Stream in 1080p 60fps quality" },
                { title: "Exclusive Badge", description: "Show off your Serika+ supporter badge" },
              ].map((perk) => (
                <div key={perk.title} className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-md bg-[#8B5CF6]/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Check className="w-3 h-3 text-[#8B5CF6]" />
                  </div>
                  <div>
                    <h4 className="font-medium">{perk.title}</h4>
                    <p className="text-sm text-[#666666]">{perk.description}</p>
                  </div>
                </div>
              ))}
            </div>
            
            <div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Monthly */}
                <div className="p-5 rounded-lg bg-[#111111] border border-[#1a1a1a] hover:border-[#8B5CF6]/30 transition-colors">
                  <div className="text-xs font-semibold text-[#8B5CF6] mb-2">SERIKA+M</div>
                  <div className="text-2xl font-bold mb-1">€9.99</div>
                  <div className="text-sm text-[#666666]">per month</div>
                </div>
                
                {/* Quarterly - Popular */}
                <div className="p-5 rounded-lg bg-[#8B5CF6]/10 border border-[#8B5CF6]/30 relative">
                  <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-md bg-[#8B5CF6] text-xs font-semibold">
                    POPULAR
                  </div>
                  <div className="text-xs font-semibold text-[#8B5CF6] mb-2">SERIKA+Q</div>
                  <div className="text-2xl font-bold mb-1">€24.99</div>
                  <div className="text-sm text-[#666666]">per quarter</div>
                </div>
                
                {/* Yearly */}
                <div className="p-5 rounded-lg bg-[#111111] border border-[#1a1a1a] hover:border-[#8B5CF6]/30 transition-colors">
                  <div className="text-xs font-semibold text-[#8B5CF6] mb-2">SERIKA+Y</div>
                  <div className="text-2xl font-bold mb-1">€79.99</div>
                  <div className="text-sm text-[#666666]">per year</div>
                </div>
              </div>
              
              <div className="text-center mt-8">
                <Link 
                  href="https://accounts.serika.dev"
                  className="inline-block px-8 py-3 font-medium bg-[#8B5CF6] hover:bg-[#7C3AED] rounded-md transition-colors"
                >
                  Get Serika+
                </Link>
                <p className="text-xs text-[#555555] mt-3">
                  Managed through accounts.serika.dev
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Partner Section */}
      <section id="discover" className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#8B5CF6]/10 border border-[#8B5CF6]/20 mb-6">
                <Star className="w-4 h-4 text-[#8B5CF6]" />
                <span className="text-sm text-[#8B5CF6] font-medium">Partner Program</span>
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold mb-4">
                Become a Partner
              </h2>
              <p className="text-lg text-[#666666] mb-8 leading-relaxed">
                Partner with SerikaCord to get exclusive perks for your community. 
                Get a custom invite link, partner badge, and priority support.
              </p>
              
              <div className="space-y-4 mb-8">
                {[
                  "Custom vanity invite URL (serika.cc/yourname)",
                  "Partner badge for server owner",
                  "Server featured in discovery",
                  "Priority support from our team",
                  "Exclusive partner-only features",
                ].map((benefit) => (
                  <div key={benefit} className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded-md bg-[#8B5CF6]/20 flex items-center justify-center flex-shrink-0">
                      <Check className="w-3 h-3 text-[#8B5CF6]" />
                    </div>
                    <span className="text-[#888888]">{benefit}</span>
                  </div>
                ))}
              </div>
              
              <div className="flex items-center gap-4 text-sm text-[#666666]">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  <span>100+ members required</span>
                </div>
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4" />
                  <span>Community server only</span>
                </div>
              </div>
            </div>
            
            <div className="relative">
              <div className="aspect-square rounded-lg bg-[#0a0a0a] border border-[#1a1a1a] p-8 flex items-center justify-center">
                <div className="text-center">
                  <div className="w-32 h-32 mx-auto mb-6 rounded-2xl bg-[#8B5CF6] flex items-center justify-center">
                    <Star className="w-16 h-16" />
                  </div>
                  <div className="font-bold text-xl mb-2">Your Server</div>
                  <div className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-[#8B5CF6]/10 border border-[#8B5CF6]/20">
                    <Star className="w-3 h-3 text-[#8B5CF6]" />
                    <span className="text-xs font-medium text-[#8B5CF6]">Partnered</span>
                  </div>
                  <div className="mt-4 text-sm text-[#666666]">
                    serika.cc/<span className="text-white">yourserver</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Safety Section */}
      <section id="safety" className="py-24 px-4 sm:px-6 lg:px-8 bg-[#0a0a0a]">
        <div className="max-w-5xl mx-auto text-center">
          <Shield className="w-12 h-12 mx-auto mb-6 text-[#8B5CF6]" />
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">Your Safety Matters</h2>
          <p className="text-lg text-[#666666] max-w-2xl mx-auto mb-12">
            We take safety seriously. SerikaCord is built with privacy and security in mind, 
            giving you control over your experience.
          </p>
          
          <div className="grid sm:grid-cols-3 gap-6">
            {[
              { title: "End-to-End Privacy", description: "Your data stays yours. We don't sell your information." },
              { title: "Powerful Moderation", description: "Tools to keep your community safe and welcoming." },
              { title: "You're in Control", description: "Manage who can contact you and how." },
            ].map((item) => (
              <div key={item.title} className="p-6 rounded-lg bg-[#111111] border border-[#1a1a1a]">
                <h3 className="font-semibold mb-2">{item.title}</h3>
                <p className="text-sm text-[#666666]">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">Ready to get started?</h2>
          <p className="text-lg text-[#666666] mb-8">
            Join millions of users already using SerikaCord. It&apos;s free to use.
          </p>
          <Link 
            href="/channels/@me"
            className="inline-flex items-center gap-2 px-8 py-4 text-base font-medium bg-[#8B5CF6] hover:bg-[#7C3AED] rounded-md transition-colors"
          >
            Open SerikaCord
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-4 sm:px-6 lg:px-8 border-t border-[#1a1a1a]">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
            <div>
              <h4 className="font-semibold mb-4 text-[#8B5CF6]">Product</h4>
              <ul className="space-y-2 text-sm text-[#666666]">
                <li><Link href="#" className="hover:text-white transition-colors">Download</Link></li>
                <li><Link href="#" className="hover:text-white transition-colors">Status</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4 text-[#8B5CF6]">Company</h4>
              <ul className="space-y-2 text-sm text-[#666666]">
                <li><Link href="#" className="hover:text-white transition-colors">About</Link></li>
                <li><Link href="#" className="hover:text-white transition-colors">Blog</Link></li>
                <li><Link href="#" className="hover:text-white transition-colors">Careers</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4 text-[#8B5CF6]">Resources</h4>
              <ul className="space-y-2 text-sm text-[#666666]">
                <li><Link href="#" className="hover:text-white transition-colors">Support</Link></li>
                <li><Link href="#" className="hover:text-white transition-colors">Safety</Link></li>
                <li><Link href="#" className="hover:text-white transition-colors">Developers</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4 text-[#8B5CF6]">Legal</h4>
              <ul className="space-y-2 text-sm text-[#666666]">
                <li><Link href="#" className="hover:text-white transition-colors">Terms</Link></li>
                <li><Link href="#" className="hover:text-white transition-colors">Privacy</Link></li>
                <li><Link href="#" className="hover:text-white transition-colors">Guidelines</Link></li>
              </ul>
            </div>
          </div>
          
          <div className="flex flex-col sm:flex-row items-center justify-between pt-8 border-t border-[#1a1a1a]">
            <div className="flex items-center gap-2 mb-4 sm:mb-0">
              <div className="w-8 h-8 rounded-lg bg-[#8B5CF6] flex items-center justify-center">
                <MessageSquare className="w-5 h-5" />
              </div>
              <span className="text-xl font-bold">SerikaCord</span>
            </div>
            <p className="text-sm text-[#666666]">
              © 2026 SerikaCord. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
