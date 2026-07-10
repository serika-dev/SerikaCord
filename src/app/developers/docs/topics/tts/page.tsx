import { DocPage, P, H2, H3, CodeBlock, Callout, Strong, InlineCode, Link2, Table, UL } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";
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

export default async function TtsDoc() {
  const gt = await getGT();
  return (
    <DocPage
      title={gt("Text-to-Speech (TTS) Guide")}
      description={gt("SerikaCord's TTS engine goes far beyond simple speech. Stack inline modifiers anywhere in your message to switch voices, change speed, boost bass, distort audio, and trigger sound effects — all in real time.")}
    >
      <Callout type="info" title={gt("How it works")}>
        {gt("TTS runs entirely in the browser using the Web Speech API, HTMLAudio, and the FishAudio proxy. Modifiers are parsed from")}{" "}<InlineCode>[bracket]</InlineCode> {gt("tags in your message text. Tags can appear at the start (as defaults) or inline anywhere (to switch mid-sentence).")}
      </Callout>

      <H2 id="basic-usage">{gt("Basic usage")}</H2>
      <P>{gt("Send a message with the")}{" "}<InlineCode>/tts</InlineCode> {gt("command:")}</P>
      <CodeBlock lang="bash">/tts Hello world</CodeBlock>
      <P>{gt("This uses your default system voice at normal speed and volume.")}</P>

      <H2 id="modifiers">{gt("Modifier syntax")}</H2>
      <P>
        {gt("Modifiers are")}{" "}<InlineCode>[keyword]</InlineCode> {gt("tags placed in the message. Leading tags set defaults for the entire message. Inline tags change the voice mid-sentence.")}
      </P>
      <CodeBlock lang="bash">/tts [f][2x] Hello! [m] Hi there!</CodeBlock>
      <P>
        {gt("The first segment (")}<InlineCode>Hello!</InlineCode>{gt(") is spoken in a female voice at 2× speed. The second (")}<InlineCode>Hi there!</InlineCode>{gt(") switches to a male voice at the same 2× speed.")}
      </P>

      <H2 id="gender">{gt("Gender")}</H2>
      <P>{gt("Switch between male and female voices:")}</P>
      <Table
        headers={[gt("Modifier"), gt("Aliases"), gt("Description")]}
        rows={[
          ["[f]", "female, girl, woman, she, her", gt("Female voice")],
          ["[m]", "male, boy, man, he, him", gt("Male voice")],
        ]}
      />
      <CodeBlock lang="bash">/tts [m] Hey guys [f] What's up?</CodeBlock>

      <H2 id="speed">{gt("Speed control")}</H2>
      <P>{gt("Control how fast the text is spoken. Range: 0.25× to 4×.")}</P>
      <Table
        headers={[gt("Modifier"), gt("Speed"), gt("Description")]}
        rows={[
          ["[0.25x]", "0.25×", gt("Very slow")],
          ["[0.5x] / [half] / [slow]", "0.5× / 0.75×", gt("Slow")],
          ["[1x] / [normal]", "1×", gt("Normal speed")],
          ["[1.5x] / [fast]", "1.5×", gt("Fast")],
          ["[2x] / [double]", "2×", gt("Double speed")],
          ["[3x] / [turbo]", "3×", gt("Turbo")],
          ["[4x]", "4×", gt("Maximum speed")],
        ]}
      />
      <CodeBlock lang="bash">/tts [turbo] gotta go fast</CodeBlock>

      <H2 id="volume">{gt("Volume & amplification")}</H2>
      <P>
        {gt("Volume is specified as a percentage from")}{" "}<Strong>0</Strong> {gt("to")}{" "}<Strong>500</Strong>. {gt("Values above 100% use the Web Audio API")}{" "}<InlineCode>GainNode</InlineCode> {gt("to amplify the signal beyond the browser's normal limit.")}
      </P>
      <Table
        headers={[gt("Modifier"), gt("Effect"), gt("Description")]}
        rows={[
          ["[vol:0]", "0%", gt("Silent")],
          ["[vol:50]", "50%", gt("Half volume")],
          ["[vol:100]", "100%", gt("Default volume")],
          ["[vol:200]", "200%", gt("2× amplification")],
          ["[vol:500]", "500%", gt("Maximum amplification (5×)")],
          ["[vol:BASS]", gt("Bass boost"), gt("Deep bass-boosted audio via BiquadFilter chain")],
          ["[vol:EAR]", gt("Ear rape"), gt("8× gain + distortion + extreme EQ — loud but intelligible")],
        ]}
      />
      <CodeBlock lang="bash">/tts [vol:200] Louder than normal
/tts [vol:BASS] Deep bass voice
/tts [fish:miku] [vol:EAR] MAXIMUM POWER</CodeBlock>

      <Callout type="warning" title={gt("Web Speech volume limit")}>
        {gt("The browser's built-in Web Speech API caps volume at 100%. Amplification above 100% works for")}{" "}<Strong>{gt("FishAudio voices")}</Strong> {gt("and")}{" "}<Strong>{gt("sound triggers")}</Strong> {gt("via the Web Audio API, but default system voices can't be amplified beyond 100%.")}
      </Callout>

      <H3 id="bass-boost">{gt("Bass boost — [vol:BASS]")}</H3>
      <P>
        {gt("Applies a 3-stage bass boost filter chain using the Web Audio API:")}
      </P>
      <UL>
        <li><Strong>Lowshelf 80Hz +25dB</Strong> — {gt("deep sub-bass rumble")}</li>
        <li><Strong>Peaking 120Hz +20dB</Strong> — {gt("mid-bass punch")}</li>
        <li><Strong>Peaking 250Hz +12dB</Strong> — {gt("upper bass warmth")}</li>
      </UL>
      <P>
        {gt("For Web Speech (default voices), bass boost lowers pitch to 0.4× for a deeper tone since Web Speech can't route through the Web Audio API.")}
      </P>

      <H3 id="ear-rape">{gt("Ear rape — [vol:EAR]")}</H3>
      <P>
        {gt("The most extreme audio effect. Still intelligible but very loud and harsh:")}
      </P>
      <UL>
        <li><Strong>{gt("8× gain amplification")}</Strong> {gt("via GainNode")}</li>
        <li><Strong>{gt("WaveShaper distortion")}</Strong> {gt("with tanh(x×10) clipping curve")}</li>
        <li><Strong>{gt("+25dB lowshelf bass")}</Strong> {gt("at 100Hz")}</li>
        <li><Strong>{gt("+10dB highshelf treble")}</Strong> {gt("at 3000Hz for harshness")}</li>
      </UL>
      <P>
        {gt("For Web Speech, ear rape sets rate to 2× and pitch to 0 (the most extreme settings that keep speech understandable).")}
      </P>

      <H2 id="personas">{gt("Voice personas")}</H2>
      <P>{gt("Special character voices with preset rate, pitch, and voice hints:")}</P>
      <Table
        headers={[gt("Modifier"), gt("Description"), gt("Rate"), gt("Pitch")]}
        rows={[
          ["[steven]", gt("Stephen Hawking style robotic voice"), "0.85×", "0.3"],
          ["[robot]", gt("Robotic monotone voice"), "0.9×", "0.2"],
          ["[narrator]", gt("Deep narrator voice"), "0.95×", "0.9"],
        ]}
      />
      <CodeBlock lang="bash">/tts [steven] The universe is governed by physics
/tts [narrator] In a world without light...</CodeBlock>

      <H2 id="accents">{gt("Accents & languages")}</H2>
      <P>
        {gt("Use accent tags to speak in different languages and regional accents. Combine with gender using")}{" "}<InlineCode>[gender-accent]</InlineCode> {gt("syntax.")}
      </P>
      <Table
        headers={[gt("Modifier"), gt("Language"), gt("Example")]}
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

      <H2 id="fish-audio">{gt("FishAudio AI voices")}</H2>
      <P>
        {gt("Use high-quality AI voices via the FishAudio proxy. Admins configure voice presets in the admin panel — clients resolve preset names to reference IDs automatically.")}
      </P>
      <Table
        headers={[gt("Modifier"), gt("Description")]}
        rows={[
          ["[fish:miku]", gt("Use the 'miku' preset (if configured by admin)")],
          ["[fish:model-id]", gt("Use a specific FishAudio model ID directly")],
        ]}
      />
      <CodeBlock lang="bash">/tts [fish:miku] Hello, I am an AI voice!
/tts [fish:b2c2681ca05f47688a9142b5c286aea6] Custom voice</CodeBlock>
      <FishVoicesList />
      <Callout type="info" title={gt("Firefox fallback")}>
        {gt("Firefox's Web Speech implementation is buggy. SerikaCord auto-detects Firefox and falls back to the admin-configured default FishAudio voice for all TTS messages.")}
      </Callout>

      <Callout type="info" title={gt("Partner — FishAudio")}>
        {gt("SerikaCord is proud to partner with")}{" "}<a href="https://fish.audio/?fpr=serika" target="_blank" rel="noreferrer" className="text-[#8B5CF6] hover:underline">FishAudio</a> {gt("for high-quality AI text-to-speech. FishAudio provides the neural voice models that power the")}{" "}<InlineCode>[fish:...]</InlineCode> {gt("modifier. Thank you to the FishAudio team for their support!")}{" "}<a href="https://fish.audio/?fpr=serika" target="_blank" rel="noreferrer" className="text-[#8B5CF6] hover:underline">{gt("Get started with FishAudio →")}</a>
      </Callout>

      <H2 id="sound-triggers">{gt("Sound triggers")}</H2>
      <P>
        {gt("Admins can configure trigger words that play sound effects mid-speech. When a trigger word is detected in the TTS text, speech")}{" "}<Strong>{gt("pauses automatically")}</Strong>, {gt("the sound plays, and then speech resumes. No special syntax is needed — just include the trigger word in your message.")}
      </P>
      <CodeBlock lang="bash">/tts bruh that was crazy</CodeBlock>
      <P>
        {gt("If")}{" "}<InlineCode>bruh</InlineCode> {gt("is configured as a sound trigger, the sound effect plays at that point in the sentence.")}
      </P>

      <H2 id="stacking">{gt("Stacking modifiers")}</H2>
      <P>
        {gt("Modifiers can be stacked in any order. Leading modifiers set defaults; inline modifiers change the current voice for subsequent text.")}
      </P>
      <CodeBlock lang="bash">/tts [f][2x][vol:200] Hey! [m] Now I'm a guy [steven] Beep boop</CodeBlock>
      <P>{gt("Breakdown:")}</P>
      <UL>
        <li><InlineCode>Hey!</InlineCode> — {gt("female, 2× speed, 200% volume")}</li>
        <li><InlineCode>Now I'm a guy</InlineCode> — {gt("male, 2× speed, 200% volume")}</li>
        <li><InlineCode>Beep boop</InlineCode> — {gt("Steven persona, 2× speed, 200% volume")}</li>
      </UL>

      <H2 id="examples">{gt("Example combinations")}</H2>
      <Table
        headers={[gt("Command"), gt("Effect")]}
        rows={[
          ["/tts [vol:BASS] [fish:miku] Hey guys", gt("AI voice with deep bass boost")],
          ["/tts [fish:miku] [vol:EAR] MAXIMUM POWER", gt("AI voice with ear rape distortion")],
          ["/tts [m][turbo] gotta go fast [f][slow] now slow down", gt("Multi-speaker with speed changes")],
          ["/tts [steven][vol:500] The singularity is near", gt("Robotic voice at maximum volume")],
          ["/tts [f-japanese] Konnichiwa [m-american] What's up", gt("Language switching mid-message")],
          ["/tts [narrator][vol:BASS] In the beginning...", gt("Deep narrator with bass boost")],
        ]}
      />
    </DocPage>
  );
}
