"use client";

import { useState, useRef } from "react";
import { Search, Clock, Star, Smile, Heart, Coffee, Gamepad2, Plane, Lightbulb, Flag, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface CustomEmoji {
  id: string;
  name: string;
  url: string;
  serverId?: string;
  serverName?: string;
  animated?: boolean;
}

interface EmojiPickerProps {
  onEmojiSelect: (emoji: string, isCustom?: boolean, emojiData?: CustomEmoji) => void;
  serverEmojis?: CustomEmoji[];
  recentEmojis?: string[];
  className?: string;
}

// All emoji categories with more comprehensive lists
const EMOJI_DATA = {
  smileys: {
    icon: Smile,
    label: "Smileys & Emotion",
    emojis: [
      "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "🙃", "😉", "😊",
      "😇", "🥰", "😍", "🤩", "😘", "😗", "☺️", "😚", "😙", "🥲", "😋", "😛",
      "😜", "🤪", "😝", "🤑", "🤗", "🤭", "🤫", "🤔", "🤐", "🤨", "😐", "😑",
      "😶", "😶‍🌫️", "😏", "😒", "🙄", "😬", "😮‍💨", "🤥", "😌", "😔", "😪", "🤤",
      "😴", "😷", "🤒", "🤕", "🤢", "🤮", "🤧", "🥵", "🥶", "🥴", "😵", "😵‍💫",
      "🤯", "🤠", "🥳", "🥸", "😎", "🤓", "🧐", "😕", "😟", "🙁", "☹️", "😮",
      "😯", "😲", "😳", "🥺", "😦", "😧", "😨", "😰", "😥", "😢", "😭", "😱",
      "😖", "😣", "😞", "😓", "😩", "😫", "🥱", "😤", "😡", "😠", "🤬", "😈",
      "👿", "💀", "☠️", "💩", "🤡", "👹", "👺", "👻", "👽", "👾", "🤖", "😺",
      "😸", "😹", "😻", "😼", "😽", "🙀", "😿", "😾", "🙈", "🙉", "🙊"
    ]
  },
  people: {
    icon: Users,
    label: "People & Body",
    emojis: [
      "👋", "🤚", "🖐️", "✋", "🖖", "👌", "🤌", "🤏", "✌️", "🤞", "🤟", "🤘",
      "🤙", "👈", "👉", "👆", "🖕", "👇", "☝️", "👍", "👎", "✊", "👊", "🤛",
      "🤜", "👏", "🙌", "👐", "🤲", "🤝", "🙏", "✍️", "💅", "🤳", "💪", "🦾",
      "🦿", "🦵", "🦶", "👂", "🦻", "👃", "🧠", "🫀", "🫁", "🦷", "🦴", "👀",
      "👁️", "👅", "👄", "👶", "🧒", "👦", "👧", "🧑", "👱", "👨", "🧔", "👩",
      "🧓", "👴", "👵", "🙍", "🙎", "🙅", "🙆", "💁", "🙋", "🧏", "🙇", "🤦",
      "🤷", "👮", "🕵️", "💂", "🥷", "👷", "🤴", "👸", "👳", "👲", "🧕", "🤵",
      "👰", "🤰", "🫃", "🤱", "👼", "🎅", "🤶", "🦸", "🦹", "🧙", "🧚", "🧛"
    ]
  },
  animals: {
    icon: Heart,
    label: "Animals & Nature",
    emojis: [
      "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐻‍❄️", "🐨", "🐯", "🦁",
      "🐮", "🐷", "🐽", "🐸", "🐵", "🙈", "🙉", "🙊", "🐒", "🐔", "🐧", "🐦",
      "🐤", "🐣", "🐥", "🦆", "🦅", "🦉", "🦇", "🐺", "🐗", "🐴", "🦄", "🐝",
      "🪱", "🐛", "🦋", "🐌", "🐞", "🐜", "🪰", "🪲", "🪳", "🦟", "🦗", "🕷️",
      "🕸️", "🦂", "🐢", "🐍", "🦎", "🦖", "🦕", "🐙", "🦑", "🦐", "🦞", "🦀",
      "🐡", "🐠", "🐟", "🐬", "🐳", "🐋", "🦈", "🐊", "🐅", "🐆", "🦓", "🦍",
      "🦧", "🦣", "🐘", "🦛", "🦏", "🐪", "🐫", "🦒", "🦘", "🦬", "🐃", "🐂",
      "🐄", "🐎", "🐖", "🐏", "🐑", "🦙", "🐐", "🦌", "🐕", "🐩", "🦮", "🐕‍🦺"
    ]
  },
  food: {
    icon: Coffee,
    label: "Food & Drink",
    emojis: [
      "🍏", "🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🫐", "🍈", "🍒",
      "🍑", "🥭", "🍍", "🥥", "🥝", "🍅", "🍆", "🥑", "🥦", "🥬", "🥒", "🌶️",
      "🫑", "🌽", "🥕", "🫒", "🧄", "🧅", "🥔", "🍠", "🥐", "🥯", "🍞", "🥖",
      "🥨", "🧀", "🥚", "🍳", "🧈", "🥞", "🧇", "🥓", "🥩", "🍗", "🍖", "🦴",
      "🌭", "🍔", "🍟", "🍕", "🫓", "🥪", "🥙", "🧆", "🌮", "🌯", "🫔", "🥗",
      "🥘", "🫕", "🥫", "🍝", "🍜", "🍲", "🍛", "🍣", "🍱", "🥟", "🦪", "🍤",
      "🍙", "🍚", "🍘", "🍥", "🥠", "🥮", "🍢", "🍡", "🍧", "🍨", "🍦", "🥧",
      "🧁", "🍰", "🎂", "🍮", "🍭", "🍬", "🍫", "🍿", "🍩", "🍪", "🌰", "🥜"
    ]
  },
  activities: {
    icon: Gamepad2,
    label: "Activities",
    emojis: [
      "⚽", "🏀", "🏈", "⚾", "🥎", "🎾", "🏐", "🏉", "🥏", "🎱", "🪀", "🏓",
      "🏸", "🏒", "🏑", "🥍", "🏏", "🪃", "🥅", "⛳", "🪁", "🏹", "🎣", "🤿",
      "🥊", "🥋", "🎽", "🛹", "🛼", "🛷", "⛸️", "🥌", "🎿", "⛷️", "🏂", "🪂",
      "🏋️", "🤼", "🤸", "⛹️", "🤺", "🤾", "🏌️", "🏇", "🧘", "🏄", "🏊", "🤽",
      "🚣", "🧗", "🚵", "🚴", "🏆", "🥇", "🥈", "🥉", "🏅", "🎖️", "🏵️", "🎗️",
      "🎫", "🎟️", "🎪", "🤹", "🎭", "🩰", "🎨", "🎬", "🎤", "🎧", "🎼", "🎹",
      "🥁", "🪘", "🎷", "🎺", "🪗", "🎸", "🪕", "🎻", "🎲", "♟️", "🎯", "🎳",
      "🎮", "🎰", "🧩"
    ]
  },
  travel: {
    icon: Plane,
    label: "Travel & Places",
    emojis: [
      "🚗", "🚕", "🚙", "🚌", "🚎", "🏎️", "🚓", "🚑", "🚒", "🚐", "🛻", "🚚",
      "🚛", "🚜", "🦯", "🦽", "🦼", "🛴", "🚲", "🛵", "🏍️", "🛺", "🚨", "🚔",
      "🚍", "🚘", "🚖", "🚡", "🚠", "🚟", "🚃", "🚋", "🚞", "🚝", "🚄", "🚅",
      "🚈", "🚂", "🚆", "🚇", "🚊", "🚉", "✈️", "🛫", "🛬", "🛩️", "💺", "🛰️",
      "🚀", "🛸", "🚁", "🛶", "⛵", "🚤", "🛥️", "🛳️", "⛴️", "🚢", "⚓", "🪝",
      "⛽", "🚧", "🚦", "🚥", "🛑", "🚏", "🗺️", "🗿", "🗽", "🗼", "🏰", "🏯",
      "🏟️", "🎡", "🎢", "🎠", "⛲", "⛱️", "🏖️", "🏝️", "🏜️", "🌋", "⛰️", "🏔️",
      "🗻", "🏕️", "⛺", "🛖", "🏠", "🏡", "🏘️", "🏚️", "🏗️", "🏭", "🏢", "🏬"
    ]
  },
  objects: {
    icon: Lightbulb,
    label: "Objects",
    emojis: [
      "⌚", "📱", "📲", "💻", "⌨️", "🖥️", "🖨️", "🖱️", "🖲️", "🕹️", "🗜️", "💽",
      "💾", "💿", "📀", "📼", "📷", "📸", "📹", "🎥", "📽️", "🎞️", "📞", "☎️",
      "📟", "📠", "📺", "📻", "🎙️", "🎚️", "🎛️", "🧭", "⏱️", "⏲️", "⏰", "🕰️",
      "⌛", "⏳", "📡", "🔋", "🔌", "💡", "🔦", "🕯️", "🪔", "🧯", "🛢️", "💸",
      "💵", "💴", "💶", "💷", "🪙", "💰", "💳", "💎", "⚖️", "🪜", "🧰", "🪛",
      "🔧", "🔨", "⚒️", "🛠️", "⛏️", "🪚", "🔩", "⚙️", "🪤", "🧱", "⛓️", "🧲",
      "🔫", "💣", "🧨", "🪓", "🔪", "🗡️", "⚔️", "🛡️", "🚬", "⚰️", "🪦", "⚱️",
      "🏺", "🔮", "📿", "🧿", "💈", "⚗️", "🔭", "🔬", "🕳️", "🩹", "🩺", "💊"
    ]
  },
  symbols: {
    icon: Heart,
    label: "Symbols",
    emojis: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❤️‍🔥", "❤️‍🩹",
      "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "💟", "☮️", "✝️", "☪️",
      "🕉️", "☸️", "✡️", "🔯", "🕎", "☯️", "☦️", "🛐", "⛎", "♈", "♉", "♊",
      "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓", "🆔", "⚛️", "🉑",
      "☢️", "☣️", "📴", "📳", "🈶", "🈚", "🈸", "🈺", "🈷️", "✴️", "🆚", "💮",
      "🉐", "㊙️", "㊗️", "🈴", "🈵", "🈹", "🈲", "🅰️", "🅱️", "🆎", "🆑", "🅾️",
      "🆘", "❌", "⭕", "🛑", "⛔", "📛", "🚫", "💯", "💢", "♨️", "🚷", "🚯",
      "🚳", "🚱", "🔞", "📵", "🚭", "❗", "❕", "❓", "❔", "‼️", "⁉️", "🔅"
    ]
  },
  flags: {
    icon: Flag,
    label: "Flags",
    emojis: [
      "🏁", "🚩", "🎌", "🏴", "🏳️", "🏳️‍🌈", "🏳️‍⚧️", "🏴‍☠️", "🇦🇨", "🇦🇩", "🇦🇪", "🇦🇫",
      "🇦🇬", "🇦🇮", "🇦🇱", "🇦🇲", "🇦🇴", "🇦🇶", "🇦🇷", "🇦🇸", "🇦🇹", "🇦🇺", "🇦🇼", "🇦🇽",
      "🇦🇿", "🇧🇦", "🇧🇧", "🇧🇩", "🇧🇪", "🇧🇫", "🇧🇬", "🇧🇭", "🇧🇮", "🇧🇯", "🇧🇱", "🇧🇲",
      "🇧🇳", "🇧🇴", "🇧🇶", "🇧🇷", "🇧🇸", "🇧🇹", "🇧🇻", "🇧🇼", "🇧🇾", "🇧🇿", "🇨🇦", "🇨🇨",
      "🇨🇩", "🇨🇫", "🇨🇬", "🇨🇭", "🇨🇮", "🇨🇰", "🇨🇱", "🇨🇲", "🇨🇳", "🇨🇴", "🇨🇵", "🇨🇷",
      "🇨🇺", "🇨🇻", "🇨🇼", "🇨🇽", "🇨🇾", "🇨🇿", "🇩🇪", "🇩🇬", "🇩🇯", "🇩🇰", "🇩🇲", "🇩🇴",
      "🇩🇿", "🇪🇦", "🇪🇨", "🇪🇪", "🇪🇬", "🇪🇭", "🇪🇷", "🇪🇸", "🇪🇹", "🇪🇺", "🇫🇮", "🇫🇯",
      "🇫🇰", "🇫🇲", "🇫🇴", "🇫🇷", "🇬🇦", "🇬🇧", "🇬🇩", "🇬🇪", "🇬🇫", "🇬🇬", "🇬🇭", "🇬🇮"
    ]
  }
};

type CategoryKey = keyof typeof EMOJI_DATA;

export function CustomEmojiPicker({
  onEmojiSelect,
  serverEmojis = [],
  recentEmojis = [],
  className,
}: EmojiPickerProps) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<CategoryKey | "recent" | "server">("smileys");
  const scrollRef = useRef<HTMLDivElement>(null);
  const categoryRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Filter emojis based on search
  const getFilteredEmojis = () => {
    if (!search.trim()) return null;
    
    const results: string[] = [];
    
    Object.values(EMOJI_DATA).forEach(({ emojis }) => {
      emojis.forEach(emoji => {
        if (results.length < 100) {
          results.push(emoji);
        }
      });
    });
    
    return results.slice(0, 50);
  };

  const filteredServerEmojis = serverEmojis.filter(emoji =>
    emoji.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleEmojiClick = (emoji: string, isCustom = false, emojiData?: CustomEmoji) => {
    onEmojiSelect(emoji, isCustom, emojiData);
  };

  const scrollToCategory = (category: string) => {
    const element = categoryRefs.current[category];
    if (element && scrollRef.current) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setActiveCategory(category as CategoryKey | "recent" | "server");
  };

  const filteredEmojis = getFilteredEmojis();

  // Category buttons for quick navigation
  const categories: Array<{ key: CategoryKey | "recent" | "server"; icon: React.ElementType; label: string }> = [
    ...(recentEmojis.length > 0 ? [{ key: "recent" as const, icon: Clock, label: "Recent" }] : []),
    { key: "smileys", icon: EMOJI_DATA.smileys.icon, label: EMOJI_DATA.smileys.label },
    { key: "people", icon: EMOJI_DATA.people.icon, label: EMOJI_DATA.people.label },
    { key: "animals", icon: EMOJI_DATA.animals.icon, label: EMOJI_DATA.animals.label },
    { key: "food", icon: EMOJI_DATA.food.icon, label: EMOJI_DATA.food.label },
    { key: "activities", icon: EMOJI_DATA.activities.icon, label: EMOJI_DATA.activities.label },
    { key: "travel", icon: EMOJI_DATA.travel.icon, label: EMOJI_DATA.travel.label },
    { key: "objects", icon: EMOJI_DATA.objects.icon, label: EMOJI_DATA.objects.label },
    { key: "symbols", icon: EMOJI_DATA.symbols.icon, label: EMOJI_DATA.symbols.label },
    { key: "flags", icon: EMOJI_DATA.flags.icon, label: EMOJI_DATA.flags.label },
    ...(serverEmojis.length > 0 ? [{ key: "server" as const, icon: Star, label: "Server" }] : []),
  ];

  return (
    <div className={cn("w-[352px] h-[435px] bg-[#111111] rounded-lg border border-[#222222] flex flex-col overflow-hidden", className)}>
      {/* Search */}
      <div className="p-3 border-b border-[#222222] flex-shrink-0">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-[#666666]" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search emojis"
            className="pl-8 bg-[#0a0a0a] border-[#333333] text-white placeholder:text-[#666666] h-8"
          />
        </div>
      </div>

      {/* Category Navigation */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-[#222222] overflow-x-auto flex-shrink-0 scrollbar-hide">
        {categories.map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            onClick={() => scrollToCategory(key)}
            className={cn(
              "p-1.5 rounded transition-colors flex-shrink-0",
              activeCategory === key
                ? "bg-[#8B5CF6]/20 text-[#8B5CF6]"
                : "text-[#888888] hover:bg-[#222222] hover:text-white"
            )}
            title={label}
          >
            <Icon className="w-4 h-4" />
          </button>
        ))}
      </div>

      {/* Emoji Grid */}
      <ScrollArea className="flex-1 overflow-y-auto">
        <div className="p-2 pb-4" ref={scrollRef}>
          {/* Search Results */}
          {filteredEmojis ? (
            <div className="mb-4">
              <h3 className="text-xs font-semibold text-[#888888] mb-2 px-1">Search Results</h3>
              <div className="grid grid-cols-8 gap-0.5">
                {filteredEmojis.map((emoji, idx) => (
                  <button
                    key={`search-${idx}`}
                    onClick={() => handleEmojiClick(emoji)}
                    className="w-9 h-9 flex items-center justify-center hover:bg-[#222222] rounded text-2xl transition-colors"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              {filteredEmojis.length === 0 && (
                <p className="text-sm text-[#666666] text-center py-4">No emojis found</p>
              )}
            </div>
          ) : (
            <>
              {/* Recent Emojis */}
              {recentEmojis.length > 0 && (
                <div 
                  ref={(el) => { categoryRefs.current["recent"] = el; }}
                  className="mb-4"
                >
                  <h3 className="text-xs font-semibold text-[#888888] mb-2 px-1">Recently Used</h3>
                  <div className="grid grid-cols-8 gap-0.5">
                    {recentEmojis.slice(0, 24).map((emoji, idx) => (
                      <button
                        key={`recent-${idx}`}
                        onClick={() => handleEmojiClick(emoji)}
                        className="w-9 h-9 flex items-center justify-center hover:bg-[#222222] rounded text-2xl transition-colors"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Server Emojis */}
              {serverEmojis.length > 0 && (
                <div 
                  key="server-emojis"
                  ref={(el) => { categoryRefs.current["server"] = el; }}
                  className="mb-4"
                >
                  <h3 className="text-xs font-semibold text-[#888888] mb-2 px-1">Server Emojis</h3>
                  <div className="grid grid-cols-8 gap-0.5">
                    {(search ? filteredServerEmojis : serverEmojis).map((emoji) => (
                      <button
                        key={`server-emoji-${emoji.id}`}
                        onClick={() => handleEmojiClick(`:${emoji.name}:`, true, emoji)}
                        className="w-9 h-9 flex items-center justify-center hover:bg-[#222222] rounded transition-colors p-1.5"
                        title={`:${emoji.name}:`}
                      >
                        <img
                          src={emoji.url}
                          alt={emoji.name}
                          className={cn(
                            "w-full h-full object-contain",
                            emoji.animated && "animate-pulse"
                          )}
                          loading="lazy"
                        />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Standard Categories */}
              {(Object.entries(EMOJI_DATA) as [CategoryKey, typeof EMOJI_DATA[CategoryKey]][]).map(([key, { label, emojis }]) => (
                <div 
                  key={key}
                  ref={(el) => { categoryRefs.current[key] = el; }}
                  className="mb-4"
                >
                  <h3 className="text-xs font-semibold text-[#888888] mb-2 px-1">{label}</h3>
                  <div className="grid grid-cols-8 gap-0.5">
                    {emojis.map((emoji, idx) => (
                      <button
                        key={`${key}-${idx}`}
                        onClick={() => handleEmojiClick(emoji)}
                        className="w-9 h-9 flex items-center justify-center hover:bg-[#222222] rounded text-2xl transition-colors"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
