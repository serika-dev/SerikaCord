/**
 * Widget system constants — 1:1 with the Discord widgets-v2 spec.
 *
 * Covers the five widget "surfaces", their layout definitions (components →
 * fields), the profile game-widget types + limits, and the game-widget tag
 * enum. Shared by the widget editor, the WidgetRenderer, the public API, and
 * the developer docs so all four stay in lockstep.
 */

// ─── Value / presentation / surface / status enums ──────────────────────────
export const WIDGET_VALUE_TYPES = ['data', 'custom_string', 'application_asset'] as const;
export type WidgetValueType = (typeof WIDGET_VALUE_TYPES)[number];

export const WIDGET_PRESENTATION_TYPES = ['text', 'number', 'duration'] as const;
export type WidgetPresentationType = (typeof WIDGET_PRESENTATION_TYPES)[number];

export const WIDGET_SURFACE_TYPES = [
  'widget_top',
  'widget_bottom',
  'add_widget_preview',
  'mini_profile',
  'activity_accessory',
] as const;
export type WidgetSurfaceType = (typeof WIDGET_SURFACE_TYPES)[number];

export const WIDGET_CONFIG_STATUS = ['draft', 'published'] as const;
export type WidgetConfigStatus = (typeof WIDGET_CONFIG_STATUS)[number];

// ─── Layout definition model ────────────────────────────────────────────────
export interface WidgetFieldDef {
  key: string;
  label: string;
  /** image fields host media; text fields host strings/numbers/durations. */
  kind: 'image' | 'text';
  required?: boolean;
  allowedPresentationTypes?: WidgetPresentationType[];
}
export interface WidgetComponentDef {
  key: string;
  label: string;
  required?: boolean;
  fields: WidgetFieldDef[];
}
export interface WidgetLayoutDef {
  key: string;
  label: string;
  description: string;
  components: WidgetComponentDef[];
}
export interface WidgetSurfaceDef {
  key: WidgetSurfaceType;
  label: string;
  description: string;
  layouts: WidgetLayoutDef[];
}

const TEXT_PRESENTATION: WidgetPresentationType[] = ['text', 'number', 'duration'];

// Reusable component builders --------------------------------------------------
function heroPrimary(): WidgetComponentDef {
  return {
    key: 'primary',
    label: 'Primary',
    required: true,
    fields: [
      { key: 'image', label: 'Image', kind: 'image', required: true },
      { key: 'title', label: 'Title', kind: 'text', required: true, allowedPresentationTypes: ['text'] },
      { key: 'description', label: 'Description', kind: 'text', allowedPresentationTypes: ['text'] },
    ],
  };
}
function statComponent(i: number): WidgetComponentDef {
  return {
    key: `stat${i}`,
    label: `Stat ${i}`,
    fields: [
      { key: 'label', label: 'Label', kind: 'text', allowedPresentationTypes: ['text'] },
      { key: 'value', label: 'Value', kind: 'text', allowedPresentationTypes: TEXT_PRESENTATION },
    ],
  };
}
function collectionItem(i: number): WidgetComponentDef {
  return {
    key: `item${i}`,
    label: `Item ${i}`,
    fields: [
      { key: 'image', label: 'Image', kind: 'image' },
      { key: 'title', label: 'Title', kind: 'text', allowedPresentationTypes: ['text'] },
      { key: 'subtitle', label: 'Subtitle', kind: 'text', allowedPresentationTypes: TEXT_PRESENTATION },
    ],
  };
}

// ─── The five surfaces + their layout definitions ───────────────────────────
export const WIDGET_SURFACES: WidgetSurfaceDef[] = [
  {
    key: 'widget_top',
    label: 'Widget Top',
    description: 'The content displayed at the top of the widget.',
    layouts: [
      {
        key: 'widget_top_hero',
        label: 'Hero',
        description: 'Title/description on the left, a full-height image fading in from the right.',
        components: [heroPrimary()],
      },
      {
        key: 'widget_top_contained',
        label: 'Contained',
        description: 'Like Hero, but the image is confined to a square icon.',
        components: [heroPrimary()],
      },
    ],
  },
  {
    key: 'widget_bottom',
    label: 'Widget Bottom',
    description: 'The content displayed at the bottom of the widget.',
    layouts: [
      {
        key: 'widget_bottom_stats',
        label: 'Stats Grid',
        description: 'Two rows of three stat items.',
        components: [1, 2, 3, 4, 5, 6].map(statComponent),
      },
      {
        key: 'widget_bottom_progress',
        label: 'Progress',
        description: 'A big image on the left with stats and a progress bar to the side.',
        components: [
          {
            key: 'progress',
            label: 'Progress',
            required: true,
            fields: [
              { key: 'image', label: 'Image', kind: 'image' },
              { key: 'label', label: 'Label', kind: 'text', allowedPresentationTypes: ['text'] },
              { key: 'current', label: 'Current Value (0.0–1.0)', kind: 'text', required: true, allowedPresentationTypes: ['number'] },
              { key: 'max', label: 'Max Value (optional)', kind: 'text', allowedPresentationTypes: ['number'] },
            ],
          },
          statComponent(1),
          statComponent(2),
          statComponent(3),
        ],
      },
      {
        key: 'widget_bottom_collection',
        label: 'Collection',
        description: 'Two rows of two items with images.',
        components: [1, 2, 3, 4].map(collectionItem),
      },
    ],
  },
  {
    key: 'add_widget_preview',
    label: 'Add Widget Preview',
    description: 'The content displayed when adding a widget.',
    layouts: [
      {
        key: 'add_widget_preview_hero',
        label: 'Hero',
        description: 'Widget Top (hero) with the Widget Bottom shown underneath.',
        components: [heroPrimary(), statComponent(1), statComponent(2), statComponent(3)],
      },
      {
        key: 'add_widget_preview_contained',
        label: 'Contained',
        description: 'Widget Top (contained) with the Widget Bottom shown underneath.',
        components: [heroPrimary(), statComponent(1), statComponent(2), statComponent(3)],
      },
    ],
  },
  {
    key: 'mini_profile',
    label: 'Mini Profile',
    description: 'A small section shown on the user mini profile.',
    layouts: [
      {
        key: 'mini_profile_hero_stat',
        label: 'Hero Stat',
        description: 'No title/description — one stat with one image, hero style.',
        components: [
          {
            key: 'primary',
            label: 'Primary',
            required: true,
            fields: [
              { key: 'image', label: 'Image', kind: 'image', required: true },
              { key: 'value', label: 'Stat Value', kind: 'text', required: true, allowedPresentationTypes: TEXT_PRESENTATION },
              { key: 'label', label: 'Stat Label', kind: 'text', allowedPresentationTypes: ['text'] },
            ],
          },
        ],
      },
      {
        key: 'mini_profile_contained_stat',
        label: 'Contained Stat',
        description: 'No title/description — one stat with one image, contained style.',
        components: [
          {
            key: 'primary',
            label: 'Primary',
            required: true,
            fields: [
              { key: 'image', label: 'Image', kind: 'image', required: true },
              { key: 'value', label: 'Stat Value', kind: 'text', required: true, allowedPresentationTypes: TEXT_PRESENTATION },
              { key: 'label', label: 'Stat Label', kind: 'text', allowedPresentationTypes: ['text'] },
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'activity_accessory',
    label: 'Activity Accessory',
    description: "Attached to the user's activity when they are playing the game.",
    layouts: [
      {
        key: 'activity_accessory_stat',
        label: 'Stat',
        description: 'A stat shown under the activity (e.g. "Playing for {stat}").',
        components: [
          {
            key: 'primary',
            label: 'Primary',
            required: true,
            fields: [
              { key: 'value', label: 'Stat', kind: 'text', required: true, allowedPresentationTypes: TEXT_PRESENTATION },
              { key: 'label', label: 'Label', kind: 'text', allowedPresentationTypes: ['text'] },
            ],
          },
        ],
      },
    ],
  },
];

/** Fast lookup: surfaceType → its surface definition. */
export const WIDGET_SURFACE_BY_KEY: Record<string, WidgetSurfaceDef> = Object.fromEntries(
  WIDGET_SURFACES.map((s) => [s.key, s]),
);

/** Fast lookup: layout key → its layout definition (across all surfaces). */
export const WIDGET_LAYOUT_BY_KEY: Record<string, WidgetLayoutDef> = Object.fromEntries(
  WIDGET_SURFACES.flatMap((s) => s.layouts.map((l) => [l.key, l])),
);

export function defaultLayoutForSurface(surface: WidgetSurfaceType): string {
  return WIDGET_SURFACE_BY_KEY[surface]?.layouts[0]?.key ?? '';
}

// ─── Profile game widgets ───────────────────────────────────────────────────
export const GAME_WIDGET_TYPES = [
  'favorite_games',
  'played_games',
  'current_games',
  'want_to_play_games',
  'application',
] as const;
export type GameWidgetType = (typeof GAME_WIDGET_TYPES)[number];

/** Max games allowed per game-widget type. `application` widgets carry no games. */
export const GAME_WIDGET_LIMITS: Record<GameWidgetType, number> = {
  favorite_games: 1,
  played_games: 20,
  current_games: 5,
  want_to_play_games: 20,
  application: 0,
};

/** Types rendered as a single "detailed" game widget on the profile. */
export const DETAILED_GAME_WIDGET_TYPES: GameWidgetType[] = ['favorite_games', 'current_games'];

/**
 * Game-widget tags. Tags flagged `skill: true` are mutually exclusive — only one
 * skill tag may be present on a game at a time (per the spec).
 */
export const GAME_WIDGET_TAGS = [
  { value: 'noob', label: 'Noob', skill: true },
  { value: 'learning_the_ropes', label: 'Learning The Ropes', skill: true },
  { value: 'casual', label: 'Casual', skill: true },
  { value: 'getting_good', label: 'Getting Good', skill: true },
  { value: 'intermediate', label: 'Intermediate', skill: true },
  { value: 'expert', label: 'Expert', skill: true },
  { value: 'better_than_you', label: 'Better Than You', skill: true },
  { value: 'obsessed', label: 'Obsessed', skill: false },
  { value: 'love_it', label: 'Love It', skill: false },
  { value: 'kind_of_love_it', label: 'Kind of Love It', skill: false },
  { value: 'kind_of_hate_it', label: 'Kind of Hate It', skill: false },
  { value: 'rage_quitting', label: 'Rage Quitting', skill: false },
  { value: 'like_it', label: 'Like It', skill: false },
  { value: 'frustrated', label: 'Frustrated', skill: false },
  { value: 'too_easy', label: 'Too Easy', skill: false },
  { value: 'looking_for_group', label: 'Looking For Group', skill: false },
  { value: 'open_to_play', label: 'Open To Play', skill: false },
  { value: 'looking_for_tips', label: 'Looking For Tips', skill: false },
  { value: 'open_to_teach', label: 'Open To Teach', skill: false },
  { value: 'looking_to_discuss', label: 'Looking To Discuss', skill: false },
] as const;
export type GameWidgetTag = (typeof GAME_WIDGET_TAGS)[number]['value'];

export const GAME_WIDGET_SKILL_TAGS = GAME_WIDGET_TAGS.filter((t) => t.skill).map((t) => t.value);
export const GAME_WIDGET_TAG_VALUES = GAME_WIDGET_TAGS.map((t) => t.value);
