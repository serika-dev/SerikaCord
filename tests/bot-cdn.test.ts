import { describe, expect, test } from 'bun:test';
import { cdnHash, cdnKeyOf, cdnRedirectUrl, isCdnHash, isSafeKey, parseCdnPath, parseSize, rewriteCdnFields } from '../src/lib/botapi/cdn';

const CDN = 'https://cdn.serika.chat';
const BUCKET = 'serikacord-media';

describe('cdnKeyOf', () => {
  test('our CDN and legacy B2 hosts', () => {
    expect(cdnKeyOf('https://cdn.serika.chat/avatars/u1/abc.png', CDN, BUCKET)).toBe('avatars/u1/abc.png');
    expect(cdnKeyOf('https://cdn.serika.chat/avatars/u1/abc.png?format=webp', CDN, BUCKET)).toBe('avatars/u1/abc.png');
    expect(cdnKeyOf('https://serikacord-media.s3.eu-central-003.backblazeb2.com/avatars/u/a.gif', CDN, BUCKET)).toBe('avatars/u/a.gif');
    expect(cdnKeyOf('https://f003.backblazeb2.com/file/serikacord-media/icons/x.png', CDN, BUCKET)).toBe('icons/x.png');
  });
  test('anything else is not ours', () => {
    expect(cdnKeyOf('https://evil.example/avatars/a.png', CDN, BUCKET)).toBeNull();
    expect(cdnKeyOf('https://cdn.serika.chat.evil.example/a.png', CDN, BUCKET)).toBeNull();
    expect(cdnKeyOf('https://f003.backblazeb2.com/file/other-bucket/a.png', CDN, BUCKET)).toBeNull();
    expect(cdnKeyOf('data:image/png;base64,AAAA', CDN, BUCKET)).toBeNull();
    // URL parsing resolves dot segments: still a plain key on our own CDN.
    expect(cdnKeyOf('https://cdn.serika.chat/a/../../etc/passwd', CDN, BUCKET)).toBe('etc/passwd');
    expect(cdnKeyOf('https://cdn.serika.chat/%2e%2e/x', CDN, BUCKET)).toBe('x');
    expect(cdnKeyOf('https://cdn.serika.chat/a%2f..%2f..%2fb', CDN, BUCKET)).toBeNull();
    expect(cdnKeyOf(null, CDN, BUCKET)).toBeNull();
  });
});

describe('hashes', () => {
  test('stable 32-hex digests, a_ for gifs', () => {
    const h = cdnHash('avatars/u1/abc.png');
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(cdnHash('avatars/u1/abc.png')).toBe(h);
    expect(cdnHash('avatars/u1/abc.gif')).toMatch(/^a_[0-9a-f]{32}$/);
    expect(isCdnHash(h)).toBe(true);
    expect(isCdnHash('../x')).toBe(false);
  });
  test('rewriteCdnFields hashes image fields only and nulls foreign URLs', () => {
    const seen: Array<[string, string]> = [];
    const out = rewriteCdnFields({
      id: 'x',
      avatar: 'https://cdn.serika.chat/avatars/u/a.png',
      banner: 'https://elsewhere.example/b.png',
      member: { avatar: null, user: { avatar: 'https://cdn.serika.chat/avatars/v/b.gif' } },
      embeds: [{ image: { url: 'https://cdn.serika.chat/attachments/x.png' }, footer: { icon_url: 'https://cdn.serika.chat/i.png' } }],
      attachments: [{ url: 'https://cdn.serika.chat/attachments/x.png' }],
      content: 'https://cdn.serika.chat/avatars/u/a.png',
    }, { cdnBase: CDN, bucket: BUCKET, remember: (h, k) => seen.push([h, k]) });
    expect(out.avatar).toBe(cdnHash('avatars/u/a.png'));
    expect(out.banner).toBeNull();
    expect(out.member.user.avatar).toMatch(/^a_/);
    expect(out.member.avatar).toBeNull();
    expect(out.embeds[0].image.url).toBe('https://cdn.serika.chat/attachments/x.png');
    expect(out.embeds[0].footer.icon_url).toBe('https://cdn.serika.chat/i.png');
    expect(out.attachments[0].url).toBe('https://cdn.serika.chat/attachments/x.png');
    expect(out.content).toBe('https://cdn.serika.chat/avatars/u/a.png');
    expect(seen.map((s) => s[1])).toEqual(['avatars/u/a.png', 'avatars/v/b.gif']);
  });
});

describe('/cdn-compat paths', () => {
  const h = '0123456789abcdef0123456789abcdef';
  test('Discord path shapes', () => {
    expect(parseCdnPath(`/avatars/123/${h}.png`)).toEqual({ kind: 'hash', resource: 'avatars', ids: ['123'], hash: h, ext: 'png' });
    expect(parseCdnPath(`/icons/123/a_${h}.gif`)).toMatchObject({ resource: 'icons', hash: `a_${h}` });
    expect(parseCdnPath(`/guilds/1/users/2/avatars/${h}.webp`)).toMatchObject({ resource: 'member-avatars', ids: ['1', '2'] });
    expect(parseCdnPath('/emojis/123.gif')).toEqual({ kind: 'emoji', id: '123', ext: 'gif' });
    expect(parseCdnPath('/stickers/123.png')).toEqual({ kind: 'sticker', id: '123', ext: 'png' });
    expect(parseCdnPath('/embed/avatars/3.png')).toEqual({ kind: 'default-avatar', index: 3, ext: 'png' });
  });
  test('rejects anything else', () => {
    expect(parseCdnPath(`/avatars/123/${h}.exe`)).toBeNull();
    expect(parseCdnPath('/avatars/123/../../x.png')).toBeNull();
    expect(parseCdnPath('/https://evil.example/x.png')).toBeNull();
    expect(parseCdnPath(`/avatars/123/${h}.png/extra`)).toBeNull();
  });
  test('size must be a power of two in 16..4096', () => {
    expect(parseSize('256')).toBe(256);
    expect(parseSize('300')).toBeNull();
    expect(parseSize('8192')).toBeNull();
    expect(parseSize(null)).toBeNull();
  });
});

describe('cdnRedirectUrl', () => {
  test('always our CDN origin with wsrv params', () => {
    expect(cdnRedirectUrl(CDN, 'avatars/u/a.png', { ext: 'webp', size: 128, animated: false }))
      .toBe('https://cdn.serika.chat/avatars/u/a.png?w=128&h=128&fit=inside&format=webp');
    expect(cdnRedirectUrl(CDN, 'avatars/u/a.gif', { ext: 'png', size: null, animated: false })).toBe('https://cdn.serika.chat/avatars/u/a.gif?format=png&n=1');
    expect(cdnRedirectUrl(CDN, 'avatars/u/a.gif', { ext: 'gif', size: null, animated: false })).toBe('https://cdn.serika.chat/avatars/u/a.gif?format=gif&n=-1');
    expect(cdnRedirectUrl(CDN, 'avatars/u/a.gif', { ext: 'webp', size: null, animated: true })).toContain('n=-1');
  });
  test('unsafe keys never produce a redirect', () => {
    expect(isSafeKey('//evil.example/x')).toBe(false);
    expect(cdnRedirectUrl(CDN, '//evil.example/x', { ext: 'png', size: null, animated: false })).toBeNull();
    expect(cdnRedirectUrl(CDN, '../x', { ext: 'png', size: null, animated: false })).toBeNull();
    expect(cdnRedirectUrl(CDN, 'a/@evil.example', { ext: 'png', size: null, animated: false })).toBeNull();
    expect(cdnRedirectUrl('javascript:alert(1)', 'a.png', { ext: 'png', size: null, animated: false })).toBeNull();
  });
});
