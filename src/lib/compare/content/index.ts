import type { AppContent, AppId, CompareSource } from "../types";
import * as commet from "./commet";
import * as discord from "./discord";
import * as discourse from "./discourse";
import * as fluxer from "./fluxer";
import * as gamevox from "./gamevox";
import * as jami from "./jami";
import * as kloak from "./kloak";
import * as matrix from "./matrix";
import * as mumble from "./mumble";
import * as nerimity from "./nerimity";
import * as osmium from "./osmium";
import * as rocketchat from "./rocketchat";
import * as root from "./root";
import * as sable from "./sable";
import * as session from "./session";
import * as signal from "./signal";
import * as simplex from "./simplex";
import * as spacebar from "./spacebar";
import * as stoat from "./stoat";
import * as teamspeak from "./teamspeak";
import * as telegram from "./telegram";
import * as valour from "./valour";
import * as xmppMovim from "./xmpp-movim";

/**
 * Every competitor's content module. Each module calls getGT() itself with
 * literal strings, so looking a module up by id is safe for the gt compiler.
 */
export const CONTENT_MODULES: Record<AppId, { sources: CompareSource[]; content: () => Promise<AppContent> }> = {
  discord,
  stoat,
  fluxer,
  root,
  nerimity,
  osmium,
  valour,
  spacebar,
  kloak,
  signal,
  telegram,
  simplex,
  session,
  jami,
  teamspeak,
  mumble,
  gamevox,
  discourse,
  rocketchat,
  matrix,
  "xmpp-movim": xmppMovim,
  sable,
  commet,
};

export function appSources(id: AppId): CompareSource[] {
  return CONTENT_MODULES[id].sources;
}

export function loadAppContent(id: AppId): Promise<AppContent> {
  return CONTENT_MODULES[id].content();
}
