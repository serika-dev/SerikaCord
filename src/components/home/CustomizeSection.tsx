import { getGT } from "gt-next/server";
import { Check } from "lucide-react";
import { SectionHeading } from "./SectionHeading";
import { MemberRow, UserPanel } from "./AppPreview";
import { PhoneFrame } from "./Devices";
import { MemberHeader } from "./preview/parts";
import { ChevronLeft, Search } from "lucide-react";

export async function CustomizeSection() {
  const gt = await getGT();

  return (
    <section id="customize" aria-labelledby="hm-custom-title" className="scroll-mt-20 py-8 sm:py-28">
      <div className="mx-auto grid max-w-[1200px] items-center gap-6 px-4 sm:gap-12 sm:px-6 lg:grid-cols-2 lg:px-10">
        <div>
          <SectionHeading
            id="hm-custom-title"
            label={gt("Customization")}
            title={gt("Make it look like you.")}
            lede={gt("Pick a theme and an accent color, give your name a nameplate, and fill your profile with a banner, a bio and the accounts you've connected.")}
          />
          <ul className="mt-5 grid gap-x-6 gap-y-2.5 sm:mt-8 sm:grid-cols-2" data-reveal data-reveal-stagger>
            {[
              gt("Light, Dark and Midnight themes"),
              gt("Your own accent color"),
              gt("Nameplates"),
              gt("Profile banners and bios"),
              gt("Custom status"),
              gt("What you're playing or listening to"),
            ].map((x) => (
              <li key={x} className="flex items-center gap-2 text-sm text-[var(--hm-ink)] sm:text-[0.95rem]">
                <Check className="h-4 w-4 shrink-0 text-[var(--hm-accent-text)]" aria-hidden />
                {x}
              </li>
            ))}
          </ul>
        </div>

        {/* The real member list and user panel, showing nameplates (built-in presets), on a phone. */}
        <div className="mx-auto w-full max-w-[320px]" aria-hidden="true" data-reveal>
          <PhoneFrame>
            <div className="flex h-full flex-col">
            <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--app-border)] px-3">
              <ChevronLeft className="h-6 w-6 text-[var(--app-muted)]" />
              <span className="min-w-0 flex-1 truncate font-semibold text-[var(--text-primary)]">{gt("Members")}</span>
              <Search className="h-5 w-5 text-[var(--app-muted)]" />
            </div>
            <div className="min-h-0 flex-1 overflow-hidden bg-[var(--app-bg)] pb-4 pt-3">
              <MemberHeader label={gt("Online")} count={5} first />
              <MemberRow name="Aya" nameplate="sakura" />
              <MemberRow name="Theo" nameplate="ocean" roleColor="#3BA55C" activity={{ kind: "game", text: "Minecraft" }} />
              <MemberRow name="Rin" nameplate="aurora" activity={{ kind: "music", text: "Lo-fi Beats — Chillhop" }} />
              <MemberRow name="Mika" nameplate="mint" />
              <MemberRow name="Jun" nameplate="ember" />
              <MemberHeader label={gt("Offline")} count={2} />
              <div className="opacity-50">
                <MemberRow name="Kai" roleColor="#f59e0b" />
                <MemberRow name="Leo" />
              </div>
            </div>
            <UserPanel name="Sora" nameplate="grape" />
            </div>
          </PhoneFrame>
        </div>
      </div>
    </section>
  );
}
