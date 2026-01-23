"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { 
  X, 
  MessageCircle, 
  MoreHorizontal, 
  UserPlus, 
  Ban,
  Volume2,
  VolumeX,
  Flag,
  Copy,
  Check,
  Settings,
  Edit3,
  Sparkles
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { BadgeList, ServerBadge, type BadgeId } from "@/components/ui/badges";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface UserProfileProps {
  user: {
    id: string;
    username: string;
    displayName: string;
    avatar?: string;
    banner?: string;
    bannerColor?: string;
    bio?: string;
    badges?: BadgeId[];
    customStatus?: string;
    status?: 'online' | 'idle' | 'dnd' | 'offline';
    createdAt?: Date;
    premiumSince?: Date;
    mutualServers?: { id: string; name: string; icon?: string }[];
    mutualFriends?: { id: string; username: string; avatar?: string }[];
    pronouns?: string;
    isStaff?: boolean;
    isPartnerOwner?: boolean;
    isPremium?: boolean;
  };
  isOpen: boolean;
  onClose: () => void;
  variant?: 'popup' | 'modal';
  isCurrentUser?: boolean;
}

const statusColors = {
  online: '#57F287',
  idle: '#F0B232',
  dnd: '#ED4245',
  offline: '#80848E',
};

const statusLabels = {
  online: 'Online',
  idle: 'Idle',
  dnd: 'Do Not Disturb',
  offline: 'Offline',
};

export function UserProfile({ user, isOpen, onClose, variant = 'popup', isCurrentUser = false }: UserProfileProps) {
  const [copiedId, setCopiedId] = useState(false);
  const router = useRouter();

  const copyUserId = () => {
    navigator.clipboard.writeText(user.id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const openSettings = () => {
    onClose();
    // Dispatch custom event to open user settings
    window.dispatchEvent(new CustomEvent('openUserSettings'));
  };

  const formatDate = (date?: Date) => {
    if (!date) return 'Unknown';
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(date));
  };

  if (variant === 'popup') {
    return (
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.15 }}
            className="w-[340px] bg-[#232428] rounded-lg shadow-xl overflow-hidden border border-[#1e1f22]"
          >
            <ProfileContent user={user} onClose={onClose} copyUserId={copyUserId} copiedId={copiedId} formatDate={formatDate} isCurrentUser={isCurrentUser} openSettings={openSettings} />
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
          />
          
          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: "spring", duration: 0.4 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] max-w-[95vw] max-h-[80vh] bg-[#232428] rounded-2xl shadow-2xl overflow-hidden z-50 border border-[#1e1f22]"
          >
            <button
              onClick={onClose}
              className="absolute top-4 right-4 z-10 p-2 rounded-full bg-black/40 hover:bg-black/60 text-white/80 hover:text-white transition-all"
            >
              <X className="w-5 h-5" />
            </button>
            <ProfileContent user={user} onClose={onClose} copyUserId={copyUserId} copiedId={copiedId} formatDate={formatDate} expanded isCurrentUser={isCurrentUser} openSettings={openSettings} />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

interface ProfileContentProps {
  user: UserProfileProps['user'];
  onClose: () => void;
  copyUserId: () => void;
  copiedId: boolean;
  formatDate: (date?: Date) => string;
  expanded?: boolean;
  isCurrentUser?: boolean;
  openSettings: () => void;
}

function ProfileContent({ user, onClose, copyUserId, copiedId, formatDate, expanded, isCurrentUser, openSettings }: ProfileContentProps) {
  return (
    <div className="relative">
      {/* Banner */}
      <div 
        className={cn(
          "w-full relative",
          expanded ? "h-[180px]" : "h-[120px]"
        )}
        style={{
          background: user.banner 
            ? `url(${user.banner}) center/cover`
            : user.bannerColor || 'linear-gradient(135deg, #5865F2 0%, #EB459E 100%)',
        }}
      >
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#232428] to-transparent" />
      </div>

      {/* Avatar & Actions */}
      <div className={cn(
        "relative px-4",
        expanded ? "-mt-16" : "-mt-14"
      )}>
        <div className="flex justify-between items-end">
          <div className="relative">
            <Avatar className={cn(
              "border-[6px] border-[#232428]",
              expanded ? "w-[128px] h-[128px]" : "w-[92px] h-[92px]"
            )}>
              <AvatarImage src={user.avatar} />
              <AvatarFallback className="bg-[#5865F2] text-white text-2xl">
                {user.displayName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            
            {/* Status indicator */}
            <div 
              className={cn(
                "absolute bottom-1 right-1 rounded-full border-4 border-[#232428]",
                expanded ? "w-7 h-7" : "w-6 h-6"
              )}
              style={{ backgroundColor: statusColors[user.status || 'offline'] }}
            />
          </div>

          <div className="flex items-center gap-2 mb-2">
            {isCurrentUser ? (
              <>
                <Button
                  size="sm"
                  onClick={openSettings}
                  className="bg-[#5865F2] hover:bg-[#4752c4] text-white h-9 rounded-full px-4"
                >
                  <Edit3 className="w-4 h-4 mr-1.5" />
                  Edit Profile
                </Button>
                
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={openSettings}
                  className="h-9 w-9 rounded-full bg-[#2b2d31] hover:bg-[#35373c] p-0"
                >
                  <Settings className="w-4 h-4 text-[#b5bac1]" />
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  className="bg-[#5865F2] hover:bg-[#4752c4] text-white h-9 rounded-full px-4"
                >
                  <MessageCircle className="w-4 h-4 mr-1.5" />
                  Message
                </Button>
                
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-9 w-9 rounded-full bg-[#2b2d31] hover:bg-[#35373c] p-0"
                    >
                      <MoreHorizontal className="w-4 h-4 text-[#b5bac1]" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="bg-[#111214] border-[#1e1f22] text-[#b5bac1]">
                    <DropdownMenuItem className="hover:bg-[#5865F2] hover:text-white cursor-pointer">
                      <UserPlus className="w-4 h-4 mr-2" />
                      Add Friend
                    </DropdownMenuItem>
                    <DropdownMenuItem className="hover:bg-[#5865F2] hover:text-white cursor-pointer">
                      <Volume2 className="w-4 h-4 mr-2" />
                      Call
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="bg-[#2b2d31]" />
                    <DropdownMenuItem onClick={copyUserId} className="hover:bg-[#5865F2] hover:text-white cursor-pointer">
                      {copiedId ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                      {copiedId ? 'Copied!' : 'Copy User ID'}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="bg-[#2b2d31]" />
                    <DropdownMenuItem className="hover:bg-[#ED4245] hover:text-white cursor-pointer text-[#ED4245]">
                      <VolumeX className="w-4 h-4 mr-2" />
                      Mute
                    </DropdownMenuItem>
                    <DropdownMenuItem className="hover:bg-[#ED4245] hover:text-white cursor-pointer text-[#ED4245]">
                      <Ban className="w-4 h-4 mr-2" />
                      Block
                    </DropdownMenuItem>
                    <DropdownMenuItem className="hover:bg-[#ED4245] hover:text-white cursor-pointer text-[#ED4245]">
                      <Flag className="w-4 h-4 mr-2" />
                      Report
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        </div>
      </div>

      {/* User Info Card */}
      <div className="px-4 pb-4">
        <div className="bg-[#111214] rounded-xl p-4 mt-3">
          {/* Name & Badges */}
          <div className="flex items-start justify-between mb-1">
            <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                {user.displayName}
                {user.badges && user.badges.length > 0 && (
                  <BadgeList badges={user.badges} size="md" />
                )}
              </h2>
              <p className="text-sm text-[#b5bac1]">@{user.username}</p>
              {user.pronouns && (
                <p className="text-xs text-[#949ba4] mt-0.5">{user.pronouns}</p>
              )}
            </div>
            
            {user.isPartnerOwner && (
              <ServerBadge type="partnered" />
            )}
          </div>

          {/* Custom Status */}
          {user.customStatus && (
            <div className="flex items-center gap-2 mt-3 text-sm text-[#b5bac1]">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: statusColors[user.status || 'offline'] }} />
              {user.customStatus}
            </div>
          )}

          <Separator className="my-3 bg-[#2b2d31]" />

          {expanded ? (
            <Tabs defaultValue="about" className="w-full">
              <TabsList className="w-full bg-[#1e1f22] rounded-lg h-10">
                <TabsTrigger value="about" className="flex-1 data-[state=active]:bg-[#5865F2] data-[state=active]:text-white rounded-md">
                  About Me
                </TabsTrigger>
                {!isCurrentUser && (
                  <>
                    <TabsTrigger value="servers" className="flex-1 data-[state=active]:bg-[#5865F2] data-[state=active]:text-white rounded-md">
                      Mutual Servers
                    </TabsTrigger>
                    <TabsTrigger value="friends" className="flex-1 data-[state=active]:bg-[#5865F2] data-[state=active]:text-white rounded-md">
                      Mutual Friends
                    </TabsTrigger>
                  </>
                )}
              </TabsList>
              
              <TabsContent value="about" className="mt-4">
                {isCurrentUser ? (
                  <>
                    {user.bio ? (
                      <p className="text-sm text-[#dbdee1] whitespace-pre-wrap">{user.bio}</p>
                    ) : (
                      <div className="text-center py-4">
                        <p className="text-sm text-[#6d6f78] mb-3">You haven't set a bio yet</p>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={openSettings}
                          className="text-[#00A8FC] hover:text-[#00A8FC] hover:bg-[#00A8FC]/10"
                        >
                          <Edit3 className="w-4 h-4 mr-1.5" />
                          Add Bio
                        </Button>
                      </div>
                    )}
                    
                    <div className="mt-4 space-y-2">
                      <div>
                        <h4 className="text-xs font-bold uppercase text-[#b5bac1] mb-1">Member Since</h4>
                        <p className="text-sm text-[#dbdee1]">{formatDate(user.createdAt)}</p>
                      </div>
                      {user.premiumSince ? (
                        <div>
                          <h4 className="text-xs font-bold uppercase text-[#F0B232] mb-1 flex items-center gap-1">
                            ✨ Serika+ Since
                          </h4>
                          <p className="text-sm text-[#dbdee1]">{formatDate(user.premiumSince)}</p>
                        </div>
                      ) : (
                        <div className="mt-4 p-3 rounded-lg bg-gradient-to-r from-[#F0B232]/10 to-[#8B5CF6]/10 border border-[#F0B232]/20">
                          <div className="flex items-center gap-2 mb-2">
                            <Sparkles className="w-4 h-4 text-[#F0B232]" />
                            <span className="text-sm font-semibold text-[#F0B232]">Get Serika+</span>
                          </div>
                          <p className="text-xs text-[#b5bac1]">Unlock custom profiles, animated avatars, and more!</p>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    {user.bio ? (
                      <p className="text-sm text-[#dbdee1] whitespace-pre-wrap">{user.bio}</p>
                    ) : (
                      <p className="text-sm text-[#6d6f78] italic">No bio yet</p>
                    )}
                    
                    <div className="mt-4 space-y-2">
                      <div>
                        <h4 className="text-xs font-bold uppercase text-[#b5bac1] mb-1">Member Since</h4>
                        <p className="text-sm text-[#dbdee1]">{formatDate(user.createdAt)}</p>
                      </div>
                      {user.premiumSince && (
                        <div>
                          <h4 className="text-xs font-bold uppercase text-[#F0B232] mb-1 flex items-center gap-1">
                            ✨ Serika+ Since
                          </h4>
                          <p className="text-sm text-[#dbdee1]">{formatDate(user.premiumSince)}</p>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </TabsContent>
              
              {!isCurrentUser && (
                <>
                  <TabsContent value="servers" className="mt-4">
                    <ScrollArea className="h-[200px]">
                      {user.mutualServers && user.mutualServers.length > 0 ? (
                        <div className="space-y-2">
                          {user.mutualServers.map((server) => (
                            <div key={server.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-[#1e1f22] transition-colors cursor-pointer">
                              <Avatar className="w-10 h-10">
                                <AvatarImage src={server.icon} />
                                <AvatarFallback className="bg-[#5865F2] text-white text-sm">
                                  {server.name.charAt(0)}
                                </AvatarFallback>
                              </Avatar>
                              <span className="text-sm text-[#dbdee1] font-medium">{server.name}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-[#6d6f78] italic text-center py-8">No mutual servers</p>
                      )}
                    </ScrollArea>
                  </TabsContent>
                  
                  <TabsContent value="friends" className="mt-4">
                    <ScrollArea className="h-[200px]">
                      {user.mutualFriends && user.mutualFriends.length > 0 ? (
                        <div className="space-y-2">
                          {user.mutualFriends.map((friend) => (
                            <div key={friend.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-[#1e1f22] transition-colors cursor-pointer">
                              <Avatar className="w-10 h-10">
                                <AvatarImage src={friend.avatar} />
                                <AvatarFallback className="bg-[#5865F2] text-white text-sm">
                                  {friend.username.charAt(0)}
                                </AvatarFallback>
                              </Avatar>
                              <span className="text-sm text-[#dbdee1] font-medium">@{friend.username}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-[#6d6f78] italic text-center py-8">No mutual friends</p>
                      )}
                    </ScrollArea>
                  </TabsContent>
                </>
              )}
            </Tabs>
          ) : (
            <>
              {/* About Me */}
              {user.bio && (
                <div className="mb-3">
                  <h4 className="text-xs font-bold uppercase text-[#b5bac1] mb-1.5">About Me</h4>
                  <p className="text-sm text-[#dbdee1] line-clamp-3">{user.bio}</p>
                </div>
              )}

              {/* Member Since */}
              <div>
                <h4 className="text-xs font-bold uppercase text-[#b5bac1] mb-1.5">Member Since</h4>
                <p className="text-sm text-[#dbdee1]">{formatDate(user.createdAt)}</p>
              </div>

              {/* Serika+ */}
              {user.premiumSince && (
                <div className="mt-2">
                  <h4 className="text-xs font-bold uppercase text-[#F0B232] mb-1.5 flex items-center gap-1">
                    ✨ Serika+ Since
                  </h4>
                  <p className="text-sm text-[#dbdee1]">{formatDate(user.premiumSince)}</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
