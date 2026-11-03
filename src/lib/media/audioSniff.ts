/**
 * Whether the first bytes of a file are a real audio container: what voice
 * messages and sound uploads actually produce (WebM / Ogg / MP4 / MP3 / WAV /
 * FLAC / AAC). The upload's claimed `audio/*` type is set by the client.
 */
export function looksLikeAudio(head: Uint8Array): boolean {
  if (head.length < 4) return false;
  const at = (i: number, ...bytes: number[]) => bytes.every((b, k) => head[i + k] === b);
  const ascii = (i: number, s: string) => at(i, ...[...s].map((c) => c.charCodeAt(0)));
  return at(0, 0x1a, 0x45, 0xdf, 0xa3) // WebM / Matroska
    || ascii(0, 'OggS')
    || ascii(4, 'ftyp') // MP4 / M4A / 3GP
    || ascii(0, 'ID3') // MP3 with tags
    || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) // MPEG audio / AAC ADTS frame sync
    || (ascii(0, 'RIFF') && head.length >= 12 && ascii(8, 'WAVE'))
    || ascii(0, 'fLaC');
}
