// Upload and feature limits based on user/server status

export const UPLOAD_LIMITS = {
  // Regular users
  FREE: {
    maxFileSize: 500 * 1024 * 1024, // 500MB
    maxFileSizeDisplay: '500MB',
    maxAvatarSize: 2 * 1024 * 1024, // 2MB
    maxBannerSize: 5 * 1024 * 1024, // 5MB
    allowedFormats: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    allowedVideoFormats: ['mp4', 'webm'],
    maxVideoDuration: 60, // seconds
    dailyUploadLimit: 50,
  },
  
  // Serika+ subscribers
  SERIKA_PLUS: {
    maxFileSize: 2 * 1024 * 1024 * 1024, // 2GB
    maxFileSizeDisplay: '2GB',
    maxAvatarSize: 10 * 1024 * 1024, // 10MB
    maxBannerSize: 25 * 1024 * 1024, // 25MB
    allowedFormats: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'apng'],
    allowedVideoFormats: ['mp4', 'webm', 'mov'],
    maxVideoDuration: 300, // 5 minutes
    dailyUploadLimit: Infinity,
    animatedAvatar: true,
    animatedBanner: true,
    customProfileTheme: true,
    hdStreaming: true,
  },
} as const;

export const MESSAGE_LIMITS = {
  FREE: {
    maxLength: 2000,
    maxEmbeds: 5,
    maxAttachments: 10,
    maxReactions: 20,
    maxMentions: 20,
  },
  SERIKA_PLUS: {
    maxLength: 4000,
    maxEmbeds: 10,
    maxAttachments: 25,
    maxReactions: 50,
    maxMentions: 50,
    longerMessages: true,
  },
} as const;

export const SERVER_LIMITS = {
  FREE: {
    maxServers: 100,
    maxChannels: 500,
    maxRoles: 250,
    maxEmoji: 500,
    maxStickers: 500,
    maxSoundboardSounds: 500,
    maxMembers: 500000,
    maxBans: 10000,
  },
  BOOSTED_TIER_1: {
    maxEmoji: 500,
    maxStickers: 500,
    maxSoundboardSounds: 500,
    audioQualityKbps: 128,
  },
  BOOSTED_TIER_2: {
    maxEmoji: 500,
    maxStickers: 500,
    maxSoundboardSounds: 500,
    audioQualityKbps: 256,
  },
  BOOSTED_TIER_3: {
    maxEmoji: 500,
    maxStickers: 500,
    maxSoundboardSounds: 500,
    audioQualityKbps: 384,
  },
} as const;

export const CUSTOMIZATION_OPTIONS = {
  FREE: {
    profileColors: false,
    customBio: true,
    maxBioLength: 1000,
    customStatus: true,
    maxStatusLength: 128,
  },
  SERIKA_PLUS: {
    profileColors: true,
    customBio: true,
    maxBioLength: 1000,
    customStatus: true,
    maxStatusLength: 256,
    profileThemes: true,
    bannerAnimations: true,
    customAboutMe: true,
  },
} as const;

export function getUserLimits(isPremium: boolean) {
  return {
    upload: isPremium ? UPLOAD_LIMITS.SERIKA_PLUS : UPLOAD_LIMITS.FREE,
    message: isPremium ? MESSAGE_LIMITS.SERIKA_PLUS : MESSAGE_LIMITS.FREE,
    customization: isPremium ? CUSTOMIZATION_OPTIONS.SERIKA_PLUS : CUSTOMIZATION_OPTIONS.FREE,
  };
}
