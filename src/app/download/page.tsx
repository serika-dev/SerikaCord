"use client";

import { useEffect, useState } from "react";
import { Monitor, Smartphone, Download, Apple, ExternalLink, Loader2 } from "lucide-react";
import Link from "next/link";
import { T, useGT } from "gt-next";

// Platform detection
type Platform = 'windows' | 'mac' | 'linux' | 'android' | 'ios' | 'unknown';

function detectPlatform(): Platform {
  if (typeof window === 'undefined') return 'unknown';
  const userAgent = navigator.userAgent.toLowerCase();
  
  if (userAgent.includes('android')) return 'android';
  if (userAgent.includes('iphone') || userAgent.includes('ipad')) return 'ios';
  if (userAgent.includes('win')) return 'windows';
  if (userAgent.includes('mac')) return 'mac';
  if (userAgent.includes('linux')) return 'linux';
  return 'unknown';
}

const GITHUB_RELEASE_URL = "https://github.com/serika-dev/SerikaCord/releases/latest";

interface DownloadInfo {
  name: string;
  icon: string;
  file?: string;
  files?: { name: string; file: string; }[];
  instructions: string;
  comingSoon?: boolean;
}

const platformNames: Record<string, string> = {
  windows: 'Windows',
  mac: 'macOS',
  linux: 'Linux',
  android: 'Android',
  ios: 'iOS',
};

const platformIcons: Record<string, string> = {
  windows: '🪟',
  mac: '🍎',
  linux: '🐧',
  android: '🤖',
  ios: '🍎',
};

const platformFiles: Record<string, string | { name: string; file: string }[]> = {
  windows: 'SerikaCord-Setup-{version}.exe',
  mac: 'SerikaCord-{version}.dmg',
  linux: [
    { name: 'AppImage', file: 'SerikaCord-{version}.AppImage' },
    { name: 'Debian/Ubuntu (.deb)', file: 'serikacord-desktop_{version}_amd64.deb' },
    { name: 'Tarball', file: 'serikacord-desktop-{version}.tar.gz' },
  ],
  android: 'app-release.apk',
};

const comingSoonPlatforms = ['ios'];

export default function DownloadPage() {
  const gt = useGT();
  const [platform, setPlatform] = useState<Platform>('unknown');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setPlatform(detectPlatform());
    setIsLoading(false);
  }, []);

  const isMobile = platform === 'android' || platform === 'ios';
  const isDesktop = platform === 'windows' || platform === 'mac' || platform === 'linux';

  const getInstructions = (p: string): string => {
    switch (p) {
      case 'windows': return gt('Download and run the installer');
      case 'mac': return gt('Download the .dmg file and drag to Applications');
      case 'linux': return gt('Download the AppImage or .deb package');
      case 'android': return gt('Download the APK and install (may need to enable unknown sources)');
      case 'ios': return gt('iOS app coming soon. Use the PWA for now.');
      default: return '';
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col">
      {/* Header */}
      <header className="border-b border-[#1a1a1a] bg-[#0a0a0a]/80 backdrop-blur-lg sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#8B5CF6] flex items-center justify-center">
              <span className="text-white font-bold text-sm">S</span>
            </div>
            <span className="text-white font-semibold text-lg">SerikaCord</span>
          </Link>
          <Link
            href="/channels/me"
            className="px-4 py-2 bg-[#8B5CF6] hover:bg-[#7C4DFF] text-white rounded-lg font-medium transition-colors"
          >
            {gt("Open in Browser")}
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 py-16 px-4">
        <div className="max-w-4xl mx-auto">
          {/* Hero */}
          <div className="text-center mb-12">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-[#8B5CF6] to-[#6366F1] mb-6">
              <Download className="w-10 h-10 text-white" />
            </div>
            <h1 className="text-4xl font-bold text-white mb-4">
              {gt("Download SerikaCord")}
            </h1>
            <p className="text-[#b5bac1] text-lg max-w-xl mx-auto">
              {gt("Get the native app for the best experience. Available for Windows, macOS, Linux, and Android.")}
            </p>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 text-[#8B5CF6] animate-spin" />
            </div>
          ) : (
            <>
              {/* Recommended Download */}
              {platform !== 'unknown' && (
                <div className="mb-12">
                  <h2 className="text-xl font-semibold text-white mb-4 text-center">
                    {gt("Recommended for You")}
                  </h2>
                  <div className="bg-gradient-to-r from-[#8B5CF6]/20 to-[#6366F1]/20 border border-[#8B5CF6]/30 rounded-xl p-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <span className="text-4xl">
                          {platformIcons[platform] || '💻'}
                        </span>
                        <div>
                          <h3 className="text-xl font-bold text-white">
                            {gt("SerikaCord for")}{" "}{platform === 'windows' ? gt('Windows') : platform === 'mac' ? gt('macOS') : platform === 'linux' ? gt('Linux') : gt('Your Platform')}
                          </h3>
                          <p className="text-[#b5bac1]">
                            {getInstructions(platform)}
                          </p>
                        </div>
                      </div>
                      {!comingSoonPlatforms.includes(platform) && (
                        <a
                          href={GITHUB_RELEASE_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-6 py-3 bg-[#8B5CF6] hover:bg-[#7C4DFF] text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                        >
                          <Download className="w-5 h-5" />
                          {gt("Download")}
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Desktop Downloads */}
              <div className="mb-12">
                <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                  <Monitor className="w-5 h-5" />
                  {gt("Desktop")}
                </h2>
                <div className="grid md:grid-cols-3 gap-4">
                  {/* Windows */}
                  <a
                    href={GITHUB_RELEASE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-[#111111] border border-[#1a1a1a] rounded-xl p-6 hover:border-[#8B5CF6]/50 transition-colors group"
                  >
                    <span className="text-3xl mb-3 block">🪟</span>
                    <h3 className="text-lg font-semibold text-white mb-1">{gt("Windows")}</h3>
                    <p className="text-sm text-[#666666] mb-3">{gt("Windows 10+")}</p>
                    <div className="flex items-center gap-1 text-[#8B5CF6] text-sm group-hover:underline">
                      <Download className="w-4 h-4" />
                      {gt("Download .exe")}
                    </div>
                  </a>

                  {/* macOS */}
                  <a
                    href={GITHUB_RELEASE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-[#111111] border border-[#1a1a1a] rounded-xl p-6 hover:border-[#8B5CF6]/50 transition-colors group"
                  >
                    <span className="text-3xl mb-3 block">🍎</span>
                    <h3 className="text-lg font-semibold text-white mb-1">{gt("macOS")}</h3>
                    <p className="text-sm text-[#666666] mb-3">{gt("macOS 10.15+")}</p>
                    <div className="flex items-center gap-1 text-[#8B5CF6] text-sm group-hover:underline">
                      <Download className="w-4 h-4" />
                      {gt("Download .dmg")}
                    </div>
                  </a>

                  {/* Linux */}
                  <a
                    href={GITHUB_RELEASE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-[#111111] border border-[#1a1a1a] rounded-xl p-6 hover:border-[#8B5CF6]/50 transition-colors group"
                  >
                    <span className="text-3xl mb-3 block">🐧</span>
                    <h3 className="text-lg font-semibold text-white mb-1">{gt("Linux")}</h3>
                    <p className="text-sm text-[#666666] mb-3">{gt("AppImage, .deb")}</p>
                    <div className="flex items-center gap-1 text-[#8B5CF6] text-sm group-hover:underline">
                      <Download className="w-4 h-4" />
                      {gt("Download")}
                    </div>
                  </a>
                </div>
              </div>

              {/* Mobile Downloads */}
              <div className="mb-12">
                <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                  <Smartphone className="w-5 h-5" />
                  {gt("Mobile")}
                </h2>
                <div className="grid md:grid-cols-2 gap-4">
                  {/* Android */}
                  <a
                    href={GITHUB_RELEASE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-[#111111] border border-[#1a1a1a] rounded-xl p-6 hover:border-[#8B5CF6]/50 transition-colors group"
                  >
                    <span className="text-3xl mb-3 block">🤖</span>
                    <h3 className="text-lg font-semibold text-white mb-1">{gt("Android")}</h3>
                    <p className="text-sm text-[#666666] mb-3">{gt("Android 8.0+")}</p>
                    <div className="flex items-center gap-1 text-[#8B5CF6] text-sm group-hover:underline">
                      <Download className="w-4 h-4" />
                      {gt("Download APK")}
                    </div>
                  </a>

                  {/* iOS */}
                  <div className="bg-[#111111] border border-[#1a1a1a] rounded-xl p-6 opacity-60">
                    <span className="text-3xl mb-3 block">🍎</span>
    <h3 className="text-lg font-semibold text-white mb-1">{gt("iOS")}</h3>
                    <p className="text-sm text-[#666666] mb-3">{gt("Coming Soon")}</p>
                    <div className="flex items-center gap-1 text-[#666666] text-sm">
                      {gt("Use PWA for now")}
                    </div>
                  </div>
                </div>
              </div>

              {/* All Releases Link */}
              <div className="text-center">
                <a
                  href={GITHUB_RELEASE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-[#b5bac1] hover:text-white transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  {gt("View all releases on GitHub")}
                </a>
              </div>
            </>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#1a1a1a] py-6">
        <div className="max-w-5xl mx-auto px-4 text-center text-[#666666] text-sm">
          <p><T>© 2026 SerikaCord. All rights reserved.</T></p>
        </div>
      </footer>
    </div>
  );
}
