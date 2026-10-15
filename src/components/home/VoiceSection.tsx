import { getGT } from "gt-next/server";
import { Check } from "lucide-react";
import { SectionHeading } from "./SectionHeading";
import { CallPreview } from "./AppPreview";

export async function VoiceSection() {
  const gt = await getGT();

  const points = [
    gt("Share your screen at up to 1440p or source quality, at up to 60 FPS"),
    gt("Push to talk, mute and deafen keep working while the desktop app is in the background"),
    gt("Soundboard, picture-in-picture and pop-out call windows"),
    gt("Calls connect directly between devices whenever they can, encrypted in transit"),
  ];


  return (
    <section id="voice" aria-labelledby="hm-voice-title" className="scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto grid max-w-[1200px] items-center gap-12 px-4 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:px-10">
        {/* The real voice channel view: a screen share in the spotlight */}
        <div className="order-2 lg:order-1" data-reveal>
          <CallPreview />
        </div>

        <div className="order-1 lg:order-2">
          <SectionHeading
            id="hm-voice-title"
            label={gt("Voice and video")}
            title={gt("Drop into voice whenever you're free.")}
            lede={gt("Voice channels are always open: join to talk, leave when you're done. Call friends one to one or in a group, with video and screen sharing.")}
          />
          <ul className="mt-8 flex flex-col gap-3.5" data-reveal>
            {points.map((p) => (
              <li key={p} className="flex gap-3 leading-relaxed">
                <Check className="mt-1 h-4 w-4 shrink-0 text-[var(--hm-accent-text)]" aria-hidden />
                <span className="text-[var(--hm-ink)]">{p}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
