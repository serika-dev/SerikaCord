import { Outfit } from "next/font/google";
import { buildMetadata } from "@/lib/seo";
import { JsonLd, homepageJsonLd } from "@/components/seo/JsonLd";
import { faqPageJsonLd, serikaCordAppJsonLd } from "@/lib/jsonLd";
import { HomeHeader } from "@/components/home/HomeHeader";
import { HomeHero } from "@/components/home/HomeHero";
import { CommunitiesSection } from "@/components/home/CommunitiesSection";
import { PrivacySection } from "@/components/home/PrivacySection";
import { VoiceSection } from "@/components/home/VoiceSection";
import { DevelopersSection } from "@/components/home/DevelopersSection";
import { CustomizeSection } from "@/components/home/CustomizeSection";
import { AppsSection } from "@/components/home/AppsSection";
import { PartnerSection } from "@/components/home/PartnerSection";
import { CompareTeaser } from "@/components/home/CompareTeaser";
import { HomeFaq, getHomeFaq } from "@/components/home/HomeFaq";
import { HomeFinalCta, HomeFooter } from "@/components/home/HomeFooter";
import "@/components/home/home.css";

// Serika family heading face (Outfit), homepage only; the app keeps Inter.
// Other scripts fall back to Inter / Noto Kufi through --hm-display.
const display = Outfit({
  subsets: ["latin", "latin-ext"],
  variable: "--font-hm-display",
  display: "swap",
});

export const metadata = buildMetadata({
  title: "SerikaCord — Free Community Chat, Voice & Video",
  description:
    "Free chat for communities and friends: servers, voice and video, screen sharing and end-to-end encrypted DMs. No ads, made in the Netherlands.",
  path: "/",
  keywords: [
    "SerikaCord",
    "Discord alternative",
    "European Discord alternative",
    "community chat",
    "voice chat",
    "video calls",
    "screen sharing",
    "encrypted DMs",
    "end-to-end encryption",
    "no ads chat app",
    "GDPR chat app",
    "Discord-compatible bots",
    "free chat platform",
    "online communities",
    "server discovery",
  ],
});

export default async function HomePage() {
  const faq = await getHomeFaq();

  return (
    <div className={`hm-root ${display.variable}`}>
      <JsonLd data={homepageJsonLd} />
      <JsonLd data={serikaCordAppJsonLd} />
      <JsonLd data={faqPageJsonLd(faq)} />

      <HomeHeader />

      <main id="main" tabIndex={-1} className="outline-none">
        <HomeHero />
        <CommunitiesSection />
        <PrivacySection />
        <VoiceSection />
        <DevelopersSection />
        <CustomizeSection />
        <AppsSection />
        <PartnerSection />
        <CompareTeaser />
        <HomeFaq items={faq} />
        <HomeFinalCta />
      </main>

      <HomeFooter />
    </div>
  );
}
