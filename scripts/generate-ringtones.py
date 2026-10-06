"""Render SerikaCord's ringtones (normal + Halloween) from a General MIDI SoundFont.

Each tone is written as <out_dir>/<name>/{intro,loop,outro,full}.wav:
  play intro once → repeat loop while ringing → play outro; full = intro + loop + outro preview.

Usage:
  python3 scripts/generate-ringtones.py <out_dir> <soundfont.sf2>
Needs numpy, scipy, pyfluidsynth (+ libfluidsynth). Rendered with GeneralUser GS v2
(https://github.com/mrbumpy409/GeneralUser-GS). Then encode into public/sounds/<name>/, e.g.:
  ffmpeg -i loop.wav -c:a libvorbis -q:a 6 loop.ogg
  ffmpeg -i loop.wav -c:a libmp3lame -b:a 192k loop.mp3

Design notes (why it sounds the way it does):
  - Warm, organic instruments (marimba / vibraphone / celesta) with the melody in the A4–D6 range,
    so most energy sits around 400–2000 Hz instead of the ear's harsh 2–5 kHz peak.
  - One singable 4-bar melody: 2-bar idea + 2-bar answer, mostly stepwise, chord tones on strong
    beats, a breath at the end of each idea. It repeats (it's a ringtone) with a variation each time.
  - Layers build gently underneath across three phrases; the last bar of the loop is a quiet
    turnaround that is also the last bar of the intro, so the loop starts identically after either.
  - No distortion, gentle EQ dip at ~3.5 kHz, natural reverb.
"""
import os
import sys
import wave

import fluidsynth
import numpy as np
from scipy.signal import butter, lfilter, sosfilt

SR = 44100
NAMES = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5,
         "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11}

# General MIDI programs (0-based) and percussion keys
CELESTA, VIBES, MARIMBA, TUBULAR_BELLS = 8, 11, 12, 14
FINGERED_BASS, TREMOLO_STRINGS, PIZZICATO, TIMPANI = 33, 44, 45, 47
CHOIR, BASSOON, WARM_PAD = 52, 70, 89
DRUMS = "drums"
KICK, SIDE_STICK, HI_WOODBLOCK, LO_WOODBLOCK, SHAKER = 36, 37, 76, 77, 82


def midi(n):
    return n if isinstance(n, int) else NAMES[n[:-1]] + 12 * (int(n[-1]) + 1)


def diatonic(n, steps, scale):
    """Move note n by `steps` degrees of `scale` (pitch classes)."""
    octv, pc = divmod(midi(n), 12)
    pcs = sorted(scale)
    o, i = divmod(pcs.index(pc) + steps, len(pcs))
    return (octv + o) * 12 + pcs[i]


def beat_samples(bpm):
    """Beat length snapped to a multiple of 256 samples: 16th notes then fall on FluidSynth's
    64-sample block grid, so every repeat of a bar renders identically."""
    return int(round(60 / bpm * SR / 256)) * 256


# ── score ────────────────────────────────────────────────────────────────

class Score:
    def __init__(self, beat):
        self.beat = beat  # samples per beat
        self.notes = []   # (stem, program, start_sample, key, velocity, length_samples)

    def note(self, stem, program, beat, n, vel, length):
        s = int(round(beat * self.beat))
        self.notes.append((stem, program, s, midi(n), int(np.clip(vel, 1, 127)), max(64, int(length * self.beat))))

    def chord(self, stem, program, beat, notes, vel, length, roll=0.0):
        for k, n in enumerate(notes):
            self.note(stem, program, beat + k * roll, n, vel, length)


def render_stem(notes, n_samples, sf_path):
    fs = fluidsynth.Synth(gain=1.0, samplerate=float(SR), **{
        "synth.reverb.active": 0, "synth.chorus.active": 0, "synth.polyphony": 512})
    sfid = fs.sfload(sf_path)
    channels, nxt = {}, 0
    for prog in sorted({p for _, p, *_ in notes}, key=str):
        if prog == DRUMS:
            channels[prog] = 9
            fs.program_select(9, sfid, 128, 0)
        else:
            nxt += nxt == 9
            channels[prog] = nxt
            fs.program_select(nxt, sfid, 0, prog)
            nxt += 1
    events = []
    for _, prog, start, key, vel, length in notes:
        ch = channels[prog]
        events.append((start, 1, ch, key, vel))
        events.append((start + length, 0, ch, key, 0))
    events.sort(key=lambda e: (e[0], e[1]))
    chunks, pos = [], 0
    for t, on, ch, key, vel in events:
        if t > pos:
            chunks.append(fs.get_samples(t - pos))
            pos = t
        if on:
            fs.noteon(ch, key, vel)
        else:
            fs.noteoff(ch, key)
    if n_samples > pos:
        chunks.append(fs.get_samples(n_samples - pos))
    fs.delete()
    audio = np.concatenate(chunks).astype(np.float64).reshape(-1, 2).T / 32768
    return audio[:, :n_samples]


# ── mixing ───────────────────────────────────────────────────────────────

def peaking(x, f0, gain_db, q):
    """RBJ peaking EQ."""
    a = 10 ** (gain_db / 40)
    w0 = 2 * np.pi * f0 / SR
    alpha = np.sin(w0) / (2 * q)
    b = np.array([1 + alpha * a, -2 * np.cos(w0), 1 - alpha * a])
    den = np.array([1 + alpha / a, -2 * np.cos(w0), 1 - alpha / a])
    return lfilter(b / den[0], den / den[0], x)


def reverb_ir(seconds, predelay=0.02):
    rng = np.random.default_rng(7)
    n = int(seconds * 1.3 * SR)
    t = np.arange(n) / SR
    chans = []
    for _ in range(2):
        noise = rng.standard_normal(n)

        def band(kind, fc):
            return sosfilt(butter(2, fc, kind, fs=SR, output="sos"), noise)

        ir = (band("lowpass", 800) * np.exp(-6.9 * t / seconds)
              + band("bandpass", [800, 4000]) * np.exp(-6.9 * t / (seconds * 0.7))
              + 0.4 * band("highpass", 4000) * np.exp(-6.9 * t / (seconds * 0.35)))
        ir *= np.minimum(1, t / 0.015)
        ir = np.concatenate([np.zeros(int(predelay * SR)), ir])
        chans.append(ir / np.sqrt(np.sum(ir ** 2)))
    return chans


def convolve(buf, ir):
    out = np.empty_like(buf)
    for ch in range(2):
        size = 1 << (buf.shape[1] + len(ir[ch]) - 1).bit_length()
        out[ch] = np.fft.irfft(np.fft.rfft(buf[ch], size) * np.fft.rfft(ir[ch], size), size)[:buf.shape[1]]
    return sosfilt(butter(2, 200, "highpass", fs=SR, output="sos"), out)


def master_eq(buf):
    buf = sosfilt(butter(2, 35, "highpass", fs=SR, output="sos"), buf)
    buf = peaking(buf, 3500, -1.5, 0.8)  # ease the ear's most sensitive band
    return sosfilt(butter(2, 11000, "lowpass", fs=SR, output="sos"), buf)


def write_wav(path, buf):
    data = (np.clip(buf.T, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())


# ── normal ringtone: D major, ~92 BPM, marimba ───────────────────────────

class Normal:
    name = "ringtone"
    beat = beat_samples(92)
    bars = {"intro": 2, "loop": 12, "outro": 2}
    tail = 4.0
    reverb = (1.6, 0.02)
    # stem: (gain, reverb send, low-pass Hz or None)
    stems = {"lead": (1.0, 0.28, None), "keys": (0.75, 0.4, None), "pad": (0.55, 0.5, 3000),
             "bass": (0.55, 0.08, None), "perc": (0.4, 0.15, None)}
    SCALE = [2, 4, 6, 7, 9, 11, 1]

    VOICING = {  # voice-led: common tones held, the rest move by step
        "D": ["F#3", "A3", "D4"], "A": ["E3", "A3", "C#4"], "Bm": ["F#3", "B3", "D4"], "G": ["G3", "B3", "D4"],
    }
    BASS = {"D": "D2", "A": "C#2", "Bm": "B1", "G": "G1"}  # D – A/C# – Bm – G: a stepwise bass line
    CHORDS = ["D", "A", "Bm", "G"]

    HOOK = [(0, "F#5", .5), (.5, "E5", .5), (1, "D5", .5), (1.5, "A4", .5), (2, "D5", 1), (3, "E5", .5), (3.5, "F#5", .5)]
    MELODY = {
        1: HOOK,
        2: [(0, "E5", 1.5), (1.5, "C#5", .5), (2, "A4", 1.5)],  # breath on the last beat
        3: [(0, "F#5", .5), (.5, "E5", .5), (1, "D5", .5), (1.5, "B4", .5), (2, "D5", 1), (3, "F#5", .5), (3.5, "A5", .5)],
        4: [(0, "B5", 1.5), (1.5, "A5", .5), (2, "G5", .5), (2.5, "F#5", .5), (3, "E5", 1)],
        8: [(0, "B5", 1), (1, "G5", 1), (2, "A5", .5), (2.5, "G5", .5), (3, "E5", 1)],
        11: [(0, "F#5", .5), (.5, "A5", .5), (1, "B5", .5), (1.5, "D6", .5), (2, "B5", 1), (3, "A5", .5), (3.5, "F#5", .5)],
        12: [(0, "B4", .5), (.5, "D5", .5), (1, "G5", 1), (2, "E5", 1), (3, "C#5", .5), (3.5, "E5", .5)],
    }

    def bar_chords(self, bar):
        """(beat, chord) changes in a loop bar (1-based)."""
        if bar in (8, 12):
            return [(0, "G"), (2, "A")]
        return [(0, self.CHORDS[(bar - 1) % 4])]

    def melody(self, bar):
        return self.MELODY.get(bar) or self.MELODY[{5: 1, 6: 2, 7: 3, 9: 1, 10: 2}[bar]]

    def lead(self, s, t, notes, vel=88, celesta=False):
        for beat, n, ln in notes:
            v = vel + (6 if beat == 0 else 0) - (8 if beat % 1 else 0)
            s.note("lead", MARIMBA, t + beat, n, v, ln)
            if celesta:
                s.note("lead", CELESTA, t + beat, n, v * 0.45, ln)

    def harmony(self, s, t, chords, level):
        for k, (beat, ch) in enumerate(chords):
            end = chords[k + 1][0] if k + 1 < len(chords) else 4
            s.chord("pad", WARM_PAD, t + beat, self.VOICING[ch], 50 if level == 1 else 58, end - beat)
            bass = self.BASS[ch]
            if level == 1:
                s.note("bass", FINGERED_BASS, t + beat, bass, 72, (end - beat) * 0.95)
                continue
            for hit, ln, v in ((0, 1.4, 80), (1.5, 1.4, 64), (3, .9, 70)):
                if beat <= hit < end:
                    s.note("bass", FINGERED_BASS, t + hit, bass, v, min(ln, end - hit))
            # soft vibraphone comp on a gentle 3-3-2 rhythm, an octave above the pad
            voicing = [midi(n) + 12 for n in self.VOICING[ch]]
            for hit, v in ((0, 46), (1.5, 40), (3, 42)):
                if beat <= hit < end:
                    s.chord("keys", VIBES, t + hit, voicing, v, 1.2, roll=0.02)

    def perc(self, s, t, level):
        for k in range(8):
            s.note("perc", DRUMS, t + k * 0.5, SHAKER, 46 if k % 2 else 32, 0.25)
        if level >= 3:
            for beat in (0, 2.5):
                s.note("perc", DRUMS, t + beat, KICK, 58, 0.5)
            for beat in (1, 3):
                s.note("perc", DRUMS, t + beat, SIDE_STICK, 38, 0.25)

    def turnaround(self, s, t):
        """Quiet last bar of both the intro and the loop."""
        self.lead(s, t, self.MELODY[12], vel=82)
        self.harmony(s, t, self.bar_chords(12), 1)

    def intro(self, s, t):
        # a soft rolled vibraphone cue that wakes the ear up gently
        s.chord("pad", WARM_PAD, t, self.VOICING["D"], 44, 4)
        s.note("bass", FINGERED_BASS, t, "D2", 60, 3.8)
        for k, n in enumerate(["D4", "F#4", "A4", "D5", "F#5", "A5"]):
            s.note("keys", VIBES, t + k * 0.5, n, 40 + 4 * k, 2.5)
        self.turnaround(s, t + 4)

    def loop(self, s, t):
        for bar in range(1, 12):
            tb = t + (bar - 1) * 4
            level = 1 if bar <= 4 else 2 if bar <= 8 else 3
            self.lead(s, tb, self.melody(bar), celesta=level == 3)
            if level == 3 and bar in (9, 11):  # answer the hook's first notes with a soft third below
                for beat, n, ln in self.melody(bar)[:2]:
                    s.note("lead", MARIMBA, tb + beat, diatonic(n, -2, self.SCALE), 56, ln)
            self.harmony(s, tb, self.bar_chords(bar), 1 if level == 1 else 2)
            if level >= 2:
                self.perc(s, tb, level)
        self.turnaround(s, t + 44)

    def outro(self, s, t):
        self.lead(s, t, [(0, "F#5", .5), (.5, "E5", .5), (1, "D5", 1), (2, "B4", .5), (2.5, "D5", .5), (3, "C#5", 1)])
        self.harmony(s, t, [(0, "D"), (2, "G"), (3, "A")], 2)
        self.perc(s, t, 2)
        tb = t + 4
        s.note("lead", MARIMBA, tb, "D5", 92, 4)
        s.note("lead", CELESTA, tb + 0.02, "D6", 40, 4)
        s.chord("keys", VIBES, tb, ["D4", "F#4", "A4", "D5"], 58, 4, roll=0.06)
        s.chord("pad", WARM_PAD, tb, self.VOICING["D"], 52, 4)
        s.note("bass", FINGERED_BASS, tb, "D2", 74, 3.5)


# ── Halloween ringtone: D minor, ~86 BPM, celesta + pizzicato ────────────

class Halloween:
    name = "ringtone-halloween"
    beat = beat_samples(86)
    bars = {"intro": 2, "loop": 12, "outro": 2}
    tail = 5.0
    reverb = (2.3, 0.03)
    # the choir samples carry breath noise around 2.5–4 kHz; it only needs to be a soft "ooh" bed
    stems = {"lead": (1.0, 0.32, None), "keys": (0.7, 0.3, None), "pad": (0.6, 0.55, 1800),
             "bass": (0.85, 0.2, None), "perc": (0.5, 0.3, None)}

    # i – iv – VI – V in D (harmonic) minor, voice-led around a held D
    VOICING = {"Dm": ["F3", "A3", "D4"], "Gm": ["G3", "Bb3", "D4"], "Bb": ["F3", "Bb3", "D4"], "A": ["E3", "A3", "C#4"],
               "A7": ["E3", "G3", "C#4"]}
    BASS = {"Dm": "D2", "Gm": "G1", "Bb": "Bb1", "A": "A1", "A7": "A1"}
    CHORDS = ["Dm", "Gm", "Bb", "A"]

    # a staccato three-note descending motif, then its answer
    MELODY = {
        1: [(0, "A5", .45), (.5, "G5", .45), (1, "F5", .9), (2, "A5", .45), (2.5, "G5", .45), (3, "F5", .45), (3.5, "E5", .45)],
        2: [(0, "D5", .9), (1, "G5", .9), (2, "Bb5", 1.5)],
        3: [(0, "Bb5", .45), (.5, "A5", .45), (1, "F5", .9), (2, "Bb5", .45), (2.5, "A5", .45), (3, "G5", .45), (3.5, "F5", .45)],
        4: [(0, "E5", .9), (1, "C#5", .45), (1.5, "D5", .45), (2, "F5", .45), (2.5, "E5", .45), (3, "C#5", .9)],
        8: [(0, "E5", .45), (.5, "F5", .45), (1, "E5", .45), (1.5, "D5", .45), (2, "C#5", .9), (3, "A4", .9)],
        9: [(0, "D6", .45), (.5, "C#6", .45), (1, "A5", .9), (2, "D6", .45), (2.5, "C#6", .45), (3, "Bb5", .45), (3.5, "A5", .45)],
        10: [(0, "G5", .9), (1, "Bb5", .9), (2, "D6", 1.5)],
        11: [(0, "D6", .45), (.5, "C6", .45), (1, "Bb5", .9), (2, "Bb5", .45), (2.5, "A5", .45), (3, "G5", .45), (3.5, "F5", .45)],
        12: [(0, "E5", .45), (.5, "F5", .45), (1, "E5", .9), (2, "C#5", .45), (2.5, "D5", .45), (3, "E5", .9)],
    }

    def chord_of(self, bar):
        return "A7" if bar == 12 else self.CHORDS[(bar - 1) % 4]

    def melody(self, bar):
        return self.MELODY.get(bar) or self.MELODY[{5: 1, 6: 2, 7: 3}[bar]]

    def lead(self, s, t, notes, vel=90, double=False):
        for beat, n, ln in notes:
            v = vel + (6 if beat == 0 else 0) - (6 if beat % 1 else 0)
            s.note("lead", CELESTA, t + beat, n, v, ln)
            if double:
                s.note("lead", VIBES, t + beat, n, v * 0.42, ln)

    def harmony(self, s, t, ch, level):
        voicing, bass = self.VOICING[ch], self.BASS[ch]
        s.chord("pad", CHOIR, t, voicing, 42 if level == 1 else 48, 4)
        for beat in (0, 2):  # pizzicato "oom" …
            s.note("bass", PIZZICATO, t + beat, bass, 82 if beat == 0 else 70, 0.5)
        if level >= 2:
            for beat in (0, 2):
                s.note("bass", BASSOON, t + beat, bass, 64, 0.4)
            for beat in (1, 3):  # … "pah"
                s.chord("keys", PIZZICATO, t + beat, voicing, 52, 0.4)
        if level >= 3:
            s.chord("pad", TREMOLO_STRINGS, t, voicing, 40, 4)

    def perc(self, s, t):
        for k in range(4):  # tick … tock
            s.note("perc", DRUMS, t + k, HI_WOODBLOCK if k % 2 == 0 else LO_WOODBLOCK, 30, 0.2)

    def turnaround(self, s, t):
        self.lead(s, t, self.MELODY[12], vel=84)
        self.harmony(s, t, "A7", 1)

    def intro(self, s, t):
        s.note("perc", TUBULAR_BELLS, t, "D4", 52, 3.5)
        s.chord("pad", CHOIR, t, self.VOICING["Dm"], 38, 4)
        s.note("bass", PIZZICATO, t, "D2", 70, 0.5)
        for k, n in enumerate(["A5", "G#5", "G5", "F#5", "F5"]):  # a slow chromatic creep down
            s.note("lead", CELESTA, t + 1 + k * 0.5, n, 66 - 2 * k, 0.45)
        self.turnaround(s, t + 4)

    def loop(self, s, t):
        for bar in range(1, 12):
            tb = t + (bar - 1) * 4
            level = 1 if bar <= 4 else 2 if bar <= 8 else 3
            self.lead(s, tb, self.melody(bar), double=level == 3)
            self.harmony(s, tb, self.chord_of(bar), level)
            if level >= 2:
                self.perc(s, tb)
            if bar == 9:
                s.note("perc", TUBULAR_BELLS, tb, "D4", 48, 3.5)
                s.note("perc", TIMPANI, tb, "D2", 70, 2)
        self.turnaround(s, t + 44)

    def outro(self, s, t):
        self.lead(s, t, self.MELODY[1])
        self.harmony(s, t, "Dm", 2)
        self.perc(s, t)
        tb = t + 4
        s.note("lead", CELESTA, tb, "D5", 88, 4)
        s.note("lead", VIBES, tb, "D5", 40, 4)
        s.chord("pad", CHOIR, tb, self.VOICING["Dm"], 48, 4)
        s.chord("pad", TREMOLO_STRINGS, tb, self.VOICING["Dm"], 38, 3)
        s.note("bass", PIZZICATO, tb, "D2", 84, 0.6)
        s.note("bass", BASSOON, tb, "D2", 60, 1.5)
        s.note("perc", TUBULAR_BELLS, tb, "D4", 54, 4)
        s.note("perc", TIMPANI, tb, "D2", 72, 2)


# ── rendering ────────────────────────────────────────────────────────────

def render(piece, sf_path, parts):
    """Render parts back-to-back as one continuous timeline (so reverb and tails carry over)."""
    s = Score(piece.beat)
    t = 0
    for p in parts:
        getattr(piece, p)(s, t)
        t += piece.bars[p] * 4
    n = t * piece.beat + int(piece.tail * SR)
    mix = np.zeros((2, n))
    sends = np.zeros((2, n))
    for stem, (gain, send, cutoff) in piece.stems.items():
        notes = [x for x in s.notes if x[0] == stem]
        if notes:
            audio = render_stem(notes, n, sf_path) * gain
            if cutoff:
                audio = sosfilt(butter(4, cutoff, "lowpass", fs=SR, output="sos"), audio)
            mix += audio
            sends += audio * send
    return master_eq(mix + convolve(sends, reverb_ir(*piece.reverb)))


def trim_tail(buf, floor_db=-60, fade=0.3):
    level = np.max(np.abs(buf), axis=0)
    above = np.nonzero(level > 10 ** (floor_db / 20))[0]
    end = min(buf.shape[1], (above[-1] if len(above) else 0) + int(fade * SR))
    out = buf[:, :end].copy()
    out[:, -int(fade * SR):] *= np.linspace(1, 0, int(fade * SR))
    return out


def export(piece, sf_path, out_dir):
    bar = 4 * piece.beat
    I, L = piece.bars["intro"] * bar, piece.bars["loop"] * bar
    # intro → loop → loop → outro: the second loop pass carries the first pass's tail in at its start,
    # exactly like a repeat; the outro carries the loop's tail in, exactly as it will when played after it.
    t = render(piece, sf_path, ["intro", "loop", "loop", "outro"])
    parts = {
        "intro": t[:, :I],
        "loop": t[:, I + L:I + 2 * L],
        "outro": trim_tail(t[:, I + 2 * L:]),
        "full": trim_tail(np.concatenate([t[:, :I + L], t[:, I + 2 * L:]], axis=1)),
    }
    scale = 0.89 / np.max(np.abs(t))
    d = os.path.join(out_dir, piece.name)
    os.makedirs(d, exist_ok=True)
    for name, buf in parts.items():
        write_wav(os.path.join(d, f"{name}.wav"), buf * scale)
        print(f"{piece.name}/{name}: {buf.shape[1] / SR:.2f}s")


if __name__ == "__main__":
    out, sf = sys.argv[1], sys.argv[2]
    for piece in (Normal(), Halloween()):
        export(piece, sf, out)
