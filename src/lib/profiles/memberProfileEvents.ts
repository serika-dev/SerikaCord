// "Someone's server profile changed" (activity stream `member_profile_update`,
// or your own save in this tab). ServerContext refetches that server's member
// list; open profile cards / dialogs refetch the member.

type Listener = (serverId: string, userId: string) => void;
const listeners = new Set<Listener>();

export function emitMemberProfileChanged(serverId: string, userId: string): void {
  listeners.forEach((fn) => fn(serverId, userId));
}

export function onMemberProfileChanged(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
