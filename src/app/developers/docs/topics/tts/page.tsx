import { DocPage, P, H2, H3, CodeBlock, Callout, Strong, InlineCode, Link2, Table, UL } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { FishVoicesList } from "./FishVoicesList";

export const metadata = buildMetadata({
  title: "Text-to-Speech (TTS) Guide",
  description:
    "Complete guide to SerikaCord's advanced TTS engine. Multi-speaker voices, speed control, volume amplification, bass boost, ear rape, AI voices, accents, personas, and sound triggers.",
  path: "/developers/docs/topics/tts",
  keywords: [
    "SerikaCord TTS",
    "text to speech",
    "FishAudio",
    "voice modifiers",
    "bass boost",
    "multi-speaker TTS",
  ],
});

export default function TtsDoc() {
  return (
    <DocPage
      title="Text-to-Speech (TTS) Guide"
      description="SerikaCord's TTS engine goes far beyond simple speech. Stack inline modifiers anywhere in your message to switch voices, change speed, boost bass, distort audio, and trigger sound effects — all in real time."
    >
      <Callout type="info" title="How it works">
        TTS runs entirely in the browser using the Web Speech API, HTMLAudio, and the FishAudio proxy.
        Modifiers are parsed from <InlineCode>[bracket]</InlineCode> tags in your message text. Tags can
        appear at the start (as defaults) or inline anywhere (to switch mid-sentence).
      </Callout>

      <H2 id="basic-usage">Basic usage</H2>
      <P>Send a message with the <InlineCode>/tts</InlineCode> command:</P>
      <CodeBlock lang="bash">/tts Hello world</CodeBlock>
      <P>This uses your default system voice at normal speed and volume.</P>

      <H2 id="modifiers">Modifier syntax</H2>
      <P>
        Modifiers are <InlineCode>[keyword]</InlineCode> tags placed in the message. Leading tags set
        defaults for the entire message. Inline tags change the voice mid-sentence.
      </P>
      <CodeBlock lang="bash">/tts [f][2x] Hello! [m] Hi there!</CodeBlock>
      <P>
        The first segment (<InlineCode>Hello!</InlineCode>) is spoken in a female voice at 2× speed.
        The second (<InlineCode>Hi there!</InlineCode>) switches to a male voice at the same 2× speed.
      </P>

      <H2 id="gender">Gender</H2>
      <P>Switch between male and female voices:</P>
      <Table
        headers={["Modifier", "Aliases", "Description"]}
        rows={[
          ["[f]", "female, girl, woman, she, her", "Female voice"],
          ["[m]", "male, boy, man, he, him", "Male voice"],
        ]}
      />
      <CodeBlock lang="bash">/tts [m] Hey guys [f] What's up?</CodeBlock>

      <H2 id="speed">Speed control</H2>
      <P>Control how fast the text is spoken. Range: 0.25× to 4×.</P>
      <Table
        headers={["Modifier", "Speed", "Description"]}
        rows={[
          ["[0.25x]", "0.25×", "Very slow"],
          ["[0.5x] / [half] / [slow]", "0.5× / 0.75×", "Slow"],
          ["[1x] / [normal]", "1×", "Normal speed"],
          ["[1.5x] / [fast]", "1.5×", "Fast"],
          ["[2x] / [double]", "2×", "Double speed"],
          ["[3x] / [turbo]", "3×", "Turbo"],
          ["[4x]", "4×", "Maximum speed"],
        ]}
      />
      <CodeBlock lang="bash">/tts [turbo] gotta go fast</CodeBlock>

      <H2 id="volume">Volume &amp; amplification</H2>
      <P>
        Volume is specified as a percentage from <Strong>0</Strong> to <Strong>500</Strong>. Values
        above 100% use the Web Audio API <InlineCode>GainNode</InlineCode> to amplify the signal
        beyond the browser's normal limit.
      </P>
      <Table
        headers={["Modifier", "Effect", "Description"]}
        rows={[
          ["[vol:0]", "0%", "Silent"],
          ["[vol:50]", "50%", "Half volume"],
          ["[vol:100]", "100%", "Default volume"],
          ["[vol:200]", "200%", "2× amplification"],
          ["[vol:500]", "500%", "Maximum amplification (5×)"],
          ["[vol:BASS]", "Bass boost", "Deep bass-boosted audio via BiquadFilter chain"],
          ["[vol:EAR]", "Ear rape", "8× gain + distortion + extreme EQ — loud but intelligible"],
        ]}
      />
      <CodeBlock lang="bash">/tts [vol:200] Louder than normal
/tts [vol:BASS] Deep bass voice
/tts [fish:miku] [vol:EAR] MAXIMUM POWER</CodeBlock>

      <Callout type="warning" title="Web Speech volume limit">
        The browser's built-in Web Speech API caps volume at 100%. Amplification above 100% works
        for <Strong>FishAudio voices</Strong> and <Strong>sound triggers</Strong> via the Web Audio
        API, but default system voices can't be amplified beyond 100%.
      </Callout>

      <H3 id="bass-boost">Bass boost — [vol:BASS]</H3>
      <P>
        Applies a 3-stage bass boost filter chain using the Web Audio API:
      </P>
      <UL>
        <li><Strong>Lowshelf 80Hz +25dB</Strong> — deep sub-bass rumble</li>
        <li><Strong>Peaking 120Hz +20dB</Strong> — mid-bass punch</li>
        <li><Strong>Peaking 250Hz +12dB</Strong> — upper bass warmth</li>
      </UL>
      <P>
        For Web Speech (default voices), bass boost lowers pitch to 0.4× for a deeper tone since
        Web Speech can't route through the Web Audio API.
      </P>

      <H3 id="ear-rape">Ear rape — [vol:EAR]</H3>
      <P>
        The most extreme audio effect. Still intelligible but very loud and harsh:
      </P>
      <UL>
        <li><Strong>8× gain amplification</Strong> via GainNode</li>
        <li><Strong>WaveShaper distortion</Strong> with tanh(x×10) clipping curve</li>
        <li><Strong>+25dB lowshelf bass</Strong> at 100Hz</li>
        <li><Strong>+10dB highshelf treble</Strong> at 3000Hz for harshness</li>
      </UL>
      <P>
        For Web Speech, ear rape sets rate to 2× and pitch to 0 (the most extreme settings that
        keep speech understandable).
      </P>

      <H2 id="personas">Voice personas</H2>
      <P>Special character voices with preset rate, pitch, and voice hints:</P>
      <Table
        headers={["Modifier", "Description", "Rate", "Pitch"]}
        rows={[
          ["[steven]", "Stephen Hawking style robotic voice", "0.85×", "0.3"],
          ["[robot]", "Robotic monotone voice", "0.9×", "0.2"],
          ["[narrator]", "Deep narrator voice", "0.95×", "0.9"],
        ]}
      />
      <CodeBlock lang="bash">/tts [steven] The universe is governed by physics
/tts [narrator] In a world without light...</CodeBlock>

      <H2 id="accents">Accents &amp; languages</H2>
      <P>
        Use accent tags to speak in different languages and regional accents. Combine with gender
        using <InlineCode>[gender-accent]</InlineCode> syntax.
      </P>
      <Table
        headers={["Modifier", "Language", "Example"]}
        rows={[
          ["[scottish]", "en-GB (Scottish)", "/tts [f-scottish] Och aye!"],
          ["[british] / [uk]", "en-GB", "/tts [british] Cheerio!"],
          ["[american] / [us]", "en-US", "/tts [m-american] Howdy!"],
          ["[australian] / [aussie]", "en-AU", "/tts [f-aussie] G'day mate!"],
          ["[irish]", "en-IE", "/tts [irish] Top of the morning!"],
          ["[indian]", "en-IN", "/tts [m-indian] Namaste!"],
          ["[dutch]", "nl", "/tts [m-dutch] Hallo!"],
          ["[german]", "de", "/tts [f-german] Guten Tag!"],
          ["[french]", "fr", "/tts [f-french] Bonjour!"],
          ["[spanish]", "es", "/tts [m-spanish] Hola!"],
          ["[italian]", "it", "/tts [f-italian] Ciao!"],
          ["[japanese]", "ja", "/tts [f-japanese] Konnichiwa!"],
          ["[korean]", "ko", "/tts [korean] Annyeong!"],
          ["[chinese]", "zh", "/tts [m-chinese] Ni hao!"],
          ["[portuguese]", "pt", "/tts [f-portuguese] Ola!"],
          ["[russian]", "ru", "/tts [m-russian] Privet!"],
          ["[polish]", "pl", "/tts [f-polish] Czesc!"],
          ["[swedish]", "sv", "/tts [m-swedish] Hej!"],
          ["[turkish]", "tr", "/tts [f-turkish] Merhaba!"],
          ["[hindi]", "hi", "/tts [m-hindi] Namaste!"],
          ["[arabic]", "ar", "/tts [f-arabic] Marhaba!"],
        ]}
      />

      <H2 id="fish-audio">FishAudio AI voices</H2>
      <P>
        Use high-quality AI voices via the FishAudio proxy. Admins configure voice presets in the
        admin panel — clients resolve preset names to reference IDs automatically.
      </P>
      <Table
        headers={["Modifier", "Description"]}
        rows={[
          ["[fish:miku]", "Use the 'miku' preset (if configured by admin)"],
          ["[fish:model-id]", "Use a specific FishAudio model ID directly"],
        ]}
      />
      <CodeBlock lang="bash">/tts [fish:miku] Hello, I am an AI voice!
/tts [fish:b2c2681ca05f47688a9142b5c286aea6] Custom voice</CodeBlock>
      <FishVoicesList />
      <Callout type="info" title="Firefox fallback">
        Firefox's Web Speech implementation is buggy. SerikaCord auto-detects Firefox and falls
        back to the admin-configured default FishAudio voice for all TTS messages.
      </Callout>

      <Callout type="info" title="Partner — FishAudio">
        SerikaCord is proud to partner with <a href="https://fish.audio/?fpr=serika" target="_blank" rel="noreferrer" className="text-[#8B5CF6] hover:underline">FishAudio</a> for
        high-quality AI text-to-speech. FishAudio provides the neural voice models that power
        the <InlineCode>[fish:...]</InlineCode> modifier. Thank you to the FishAudio team for
        their support! <a href="https://fish.audio/?fpr=serika" target="_blank" rel="noreferrer" className="text-[#8B5CF6] hover:underline">Get started with FishAudio →</a>
      </Callout>

      <H2 id="sound-triggers">Sound triggers</H2>
      <P>
        Admins can configure trigger words that play sound effects mid-speech. When a trigger word
        is detected in the TTS text, speech <Strong>pauses automatically</Strong>, the sound plays,
        and then speech resumes. No special syntax is needed — just include the trigger word in
        your message.
      </P>
      <CodeBlock lang="bash">/tts bruh that was crazy</CodeBlock>
      <P>
        If <InlineCode>bruh</InlineCode> is configured as a sound trigger, the sound effect plays
        at that point in the sentence.
      </P>

      <H2 id="stacking">Stacking modifiers</H2>
      <P>
        Modifiers can be stacked in any order. Leading modifiers set defaults; inline modifiers
        change the current voice for subsequent text.
      </P>
      <CodeBlock lang="bash">/tts [f][2x][vol:200] Hey! [m] Now I'm a guy [steven] Beep boop</CodeBlock>
      <P>Breakdown:</P>
      <UL>
        <li><InlineCode>Hey!</InlineCode> — female, 2× speed, 200% volume</li>
        <li><InlineCode>Now I'm a guy</InlineCode> — male, 2× speed, 200% volume</li>
        <li><InlineCode>Beep boop</InlineCode> — Steven persona, 2× speed, 200% volume</li>
      </UL>

      <H2 id="examples">Example combinations</H2>
      <Table
        headers={["Command", "Effect"]}
        rows={[
          ["/tts [vol:BASS] [fish:miku] Hey guys", "AI voice with deep bass boost"],
          ["/tts [fish:miku] [vol:EAR] MAXIMUM POWER", "AI voice with ear rape distortion"],
          ["/tts [m][turbo] gotta go fast [f][slow] now slow down", "Multi-speaker with speed changes"],
          ["/tts [steven][vol:500] The singularity is near", "Robotic voice at maximum volume"],
          ["/tts [f-japanese] Konnichiwa [m-american] What's up", "Language switching mid-message"],
          ["/tts [narrator][vol:BASS] In the beginning...", "Deep narrator with bass boost"],
        ]}
      />
    </DocPage>
  );
}
