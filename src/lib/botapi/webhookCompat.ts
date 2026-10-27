/**
 * Slack- and GitHub-compatible webhook payloads -> Discord execute-webhook
 * bodies (pure; tests in tests/msgparity-webhook-compat.test.ts).
 *
 *   POST /webhooks/{id}/{token}/slack   Slack incoming-webhook JSON (text,
 *        username, icon_url, attachments[]): mrkdwn -> markdown, attachments
 *        -> embeds.
 *   POST /webhooks/{id}/{token}/github  a GitHub webhook delivery (event name
 *        in X-GitHub-Event): push, create, delete, issues, issue_comment,
 *        pull_request, pull_request_review(_comment), commit_comment, release,
 *        star / watch, fork, member, public, discussion(_comment),
 *        check_run / check_suite. Other events and actions are ignored (null).
 *
 * Everything returned still goes through executeWebhook's validation (embed
 * limits, http(s) URLs only, content length).
 */

export interface CompatMessage {
  content?: string;
  username?: string;
  avatar_url?: string;
  embeds?: Array<Record<string, unknown>>;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const httpUrl = (v: unknown): string | undefined => {
  const s = str(v).trim();
  return /^https?:\/\/\S+$/i.test(s) ? s.slice(0, 2048) : undefined;
};

/** A JSON body, or a form post with the JSON in `payload` (Slack and GitHub both allow it). */
export function parseCompatBody(body: unknown): { payload: Record<string, unknown> } {
  const b = obj(body);
  if (typeof b.payload === 'string') {
    try { return { payload: obj(JSON.parse(b.payload)) }; } catch { return { payload: {} }; }
  }
  return { payload: b };
}

// ─── Slack ────────────────────────────────────────────────────────────────────

const SLACK_COLORS: Record<string, number> = { good: 0x2eb886, warning: 0xdaa038, danger: 0xa30200 };

export function slackColor(raw: unknown): number | undefined {
  const s = str(raw).trim().toLowerCase();
  if (!s) return undefined;
  if (s in SLACK_COLORS) return SLACK_COLORS[s];
  const hex = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/.exec(s);
  if (!hex) return undefined;
  const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
  return parseInt(h, 16);
}

/** Slack mrkdwn -> Discord markdown: links, bold, strike, entities, special mentions. */
export function slackToMarkdown(text: unknown): string {
  let s = str(text);
  if (!s) return '';
  s = s.replace(/<(https?:\/\/[^|>\s]+)\|([^>]+)>/g, (_m, url: string, label: string) => `[${label}](${url})`);
  s = s.replace(/<(https?:\/\/[^|>\s]+)>/g, '$1');
  s = s.replace(/<mailto:([^|>]+)\|([^>]+)>/g, '$2');
  // <!here> / <!channel> / <!everyone> become plain words (a Slack payload never pings here).
  s = s.replace(/<!(here|channel|everyone)(?:\|[^>]*)?>/g, (_m, w: string) => `@​${w}`);
  s = s.replace(/<[@#!][^>]*\|([^>]+)>/g, '$1');
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1**$2**');
  s = s.replace(/(^|[\s(])~([^~\n]+)~(?=[\s).,!?:;]|$)/g, '$1~~$2~~');
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** One Slack attachment -> one Discord embed (undefined when it has nothing to show). */
export function slackAttachmentEmbed(raw: unknown): Record<string, unknown> | undefined {
  const a = obj(raw);
  const e: Record<string, unknown> = {};
  const color = slackColor(a.color);
  if (color !== undefined) e.color = color;
  if (str(a.author_name)) {
    e.author = { name: clip(str(a.author_name), 256), ...(httpUrl(a.author_link) ? { url: httpUrl(a.author_link) } : {}), ...(httpUrl(a.author_icon) ? { icon_url: httpUrl(a.author_icon) } : {}) };
  }
  if (str(a.title)) e.title = clip(slackToMarkdown(a.title), 256);
  if (httpUrl(a.title_link)) e.url = httpUrl(a.title_link);
  const text = slackToMarkdown(a.text) || (Object.keys(e).length === 0 ? slackToMarkdown(a.fallback) : '');
  if (text) e.description = clip(text, 4096);
  const fields = (Array.isArray(a.fields) ? a.fields : []).slice(0, 25).map(obj)
    .filter((f) => str(f.title) || str(f.value))
    .map((f) => ({ name: clip(slackToMarkdown(f.title) || '​', 256), value: clip(slackToMarkdown(f.value) || '​', 1024), inline: f.short === true }));
  if (fields.length) e.fields = fields;
  if (httpUrl(a.image_url)) e.image = { url: httpUrl(a.image_url) };
  if (httpUrl(a.thumb_url)) e.thumbnail = { url: httpUrl(a.thumb_url) };
  if (str(a.footer)) e.footer = { text: clip(slackToMarkdown(a.footer), 2048), ...(httpUrl(a.footer_icon) ? { icon_url: httpUrl(a.footer_icon) } : {}) };
  const ts = Number(a.ts);
  if (Number.isFinite(ts) && ts > 0) e.timestamp = new Date(ts * 1000).toISOString();
  const hasBody = Object.keys(e).some((k) => k !== 'color');
  return hasBody ? e : undefined;
}

/** A Slack incoming-webhook payload as a Discord execute body. */
export function slackWebhookMessage(input: { text?: unknown; username?: unknown; icon_url?: unknown; attachments?: unknown }): CompatMessage {
  const attachments = Array.isArray(input.attachments) ? input.attachments : [];
  const pretexts = attachments.map((a) => slackToMarkdown(obj(a).pretext)).filter(Boolean);
  const content = [slackToMarkdown(input.text), ...pretexts].filter(Boolean).join('\n');
  const embeds = attachments.slice(0, 10).map(slackAttachmentEmbed).filter((e): e is Record<string, unknown> => Boolean(e));
  const out: CompatMessage = {};
  if (content) out.content = clip(content, 2000);
  if (embeds.length) out.embeds = embeds;
  const username = str(input.username).trim();
  if (username) out.username = clip(username, 80);
  const avatar = httpUrl(input.icon_url);
  if (avatar) out.avatar_url = avatar;
  return out;
}

// ─── GitHub ───────────────────────────────────────────────────────────────────

/** The GitHub payload fields this converter reads (Discord documents the same list). */
export interface GithubPayload {
  action?: unknown; answer?: unknown; check_run?: unknown; check_suite?: unknown; comment?: unknown;
  commits?: unknown; compare?: unknown; discussion?: unknown; forced?: unknown; forkee?: unknown;
  head_commit?: unknown; issue?: unknown; member?: unknown; pull_request?: unknown; ref?: unknown;
  ref_type?: unknown; release?: unknown; repository?: unknown; review?: unknown; sender?: unknown;
}

const COLOR = {
  push: 0x7289da,
  open: 0xeb6420,
  close: 0x000000,
  prOpen: 0x009800,
  merged: 0x6f42c1,
  comment: 0xe68d60,
  release: 0x7289da,
  star: 0xffd700,
  fail: 0xd73a49,
  success: 0x28a745,
  misc: 0x7289da,
};

const firstLine = (s: string) => s.split(/\r?\n/)[0] ?? '';
const branchOf = (ref: string) => ref.replace(/^refs\/(heads|tags)\//, '');

function author(sender: unknown): Record<string, unknown> | undefined {
  const s = obj(sender);
  const name = str(s.login);
  if (!name) return undefined;
  return { name: clip(name, 256), ...(httpUrl(s.html_url) ? { url: httpUrl(s.html_url) } : {}), ...(httpUrl(s.avatar_url) ? { icon_url: httpUrl(s.avatar_url) } : {}) };
}

function embed(p: GithubPayload, title: string, opts: { url?: unknown; description?: string; color?: number } = {}): CompatMessage {
  const e: Record<string, unknown> = { title: clip(title, 256) };
  const url = httpUrl(opts.url);
  if (url) e.url = url;
  if (opts.description) e.description = clip(opts.description, 4096);
  if (opts.color !== undefined) e.color = opts.color;
  const a = author(p.sender);
  if (a) e.author = a;
  return { username: 'GitHub', embeds: [e] };
}

/** Body text of an issue / PR / comment, trimmed like Discord (a short preview). */
const preview = (v: unknown, n = 500) => clip(str(v).trim(), n);

/**
 * A GitHub delivery as a Discord execute body, or null when Discord would
 * post nothing for it (ping, unsupported events and actions, empty pushes).
 */
export function githubWebhookMessage(event: string | null | undefined, p: GithubPayload): CompatMessage | null {
  const repo = str(obj(p.repository).full_name) || str(obj(p.repository).name) || 'repository';
  const action = str(p.action);
  switch ((event ?? '').toLowerCase()) {
    case 'push': {
      const ref = str(p.ref);
      const commits = (Array.isArray(p.commits) ? p.commits : []).map(obj);
      if (commits.length === 0) {
        if (p.forced === true && ref.startsWith('refs/heads/')) {
          return embed(p, `[${repo}] Branch ${branchOf(ref)} was force-pushed to \`${str(obj(p.head_commit).id).slice(0, 7)}\``, { url: p.compare, color: COLOR.fail });
        }
        return null;
      }
      const lines = commits.slice(0, 5).map((c) => {
        const sha = str(c.id).slice(0, 7);
        const name = str(obj(c.author).username) || str(obj(c.author).name);
        const url = httpUrl(c.url);
        const msg = clip(firstLine(str(c.message)), 50);
        return `${url ? `[\`${sha}\`](${url})` : `\`${sha}\``} ${msg}${name ? ` - ${name}` : ''}`;
      });
      const n = commits.length;
      return embed(p, `[${repo}:${branchOf(ref)}] ${n} new commit${n === 1 ? '' : 's'}`, { url: p.compare, description: lines.join('\n'), color: COLOR.push });
    }
    case 'create':
    case 'delete': {
      const kind = str(p.ref_type) === 'tag' ? 'tag' : 'branch';
      const verb = event!.toLowerCase() === 'create' ? 'created' : 'deleted';
      return embed(p, `[${repo}] New ${kind} ${verb}: ${str(p.ref)}`.replace('New branch deleted', 'Branch deleted').replace('New tag deleted', 'Tag deleted'), { url: obj(p.repository).html_url });
    }
    case 'issues': {
      const issue = obj(p.issue);
      const label = `#${str(issue.number)} ${str(issue.title)}`;
      if (action === 'opened') return embed(p, `[${repo}] Issue opened: ${label}`, { url: issue.html_url, description: preview(issue.body), color: COLOR.open });
      if (action === 'closed') return embed(p, `[${repo}] Issue closed: ${label}`, { url: issue.html_url, color: COLOR.close });
      if (action === 'reopened') return embed(p, `[${repo}] Issue reopened: ${label}`, { url: issue.html_url, color: COLOR.open });
      return null;
    }
    case 'issue_comment': {
      if (action !== 'created') return null;
      const issue = obj(p.issue);
      const comment = obj(p.comment);
      const kind = issue.pull_request ? 'pull request' : 'issue';
      return embed(p, `[${repo}] New comment on ${kind} #${str(issue.number)}: ${str(issue.title)}`, { url: comment.html_url, description: preview(comment.body), color: COLOR.comment });
    }
    case 'pull_request': {
      const pr = obj(p.pull_request);
      const label = `#${str(pr.number)} ${str(pr.title)}`;
      if (action === 'opened') return embed(p, `[${repo}] Pull request opened: ${label}`, { url: pr.html_url, description: preview(pr.body), color: COLOR.prOpen });
      if (action === 'closed') {
        return pr.merged === true
          ? embed(p, `[${repo}] Pull request merged: ${label}`, { url: pr.html_url, color: COLOR.merged })
          : embed(p, `[${repo}] Pull request closed: ${label}`, { url: pr.html_url, color: COLOR.close });
      }
      if (action === 'reopened') return embed(p, `[${repo}] Pull request reopened: ${label}`, { url: pr.html_url, color: COLOR.prOpen });
      return null;
    }
    case 'pull_request_review': {
      if (action !== 'submitted') return null;
      const pr = obj(p.pull_request);
      const review = obj(p.review);
      const state = str(review.state).toLowerCase();
      const verb = state === 'approved' ? 'approved' : state === 'changes_requested' ? 'changes requested' : 'submitted';
      return embed(p, `[${repo}] Pull request review ${verb}: #${str(pr.number)} ${str(pr.title)}`, { url: review.html_url, description: preview(review.body), color: state === 'approved' ? COLOR.success : COLOR.comment });
    }
    case 'pull_request_review_comment': {
      if (action !== 'created') return null;
      const pr = obj(p.pull_request);
      const comment = obj(p.comment);
      return embed(p, `[${repo}] New review comment on pull request #${str(pr.number)}: ${str(pr.title)}`, { url: comment.html_url, description: preview(comment.body), color: COLOR.comment });
    }
    case 'commit_comment': {
      const comment = obj(p.comment);
      return embed(p, `[${repo}] New comment on commit \`${str(comment.commit_id).slice(0, 7)}\``, { url: comment.html_url, description: preview(comment.body), color: COLOR.comment });
    }
    case 'release': {
      if (action !== 'published') return null;
      const release = obj(p.release);
      const name = str(release.name) || str(release.tag_name);
      return embed(p, `[${repo}] New release published: ${name}`, { url: release.html_url, description: preview(release.body), color: COLOR.release });
    }
    case 'watch':
    case 'star': {
      if (action !== 'started' && action !== 'created') return null;
      return embed(p, `[${repo}] New star added`, { url: obj(p.repository).html_url, color: COLOR.star });
    }
    case 'fork': {
      const forkee = obj(p.forkee);
      return embed(p, `[${repo}] Fork created: ${str(forkee.full_name)}`, { url: forkee.html_url });
    }
    case 'member': {
      if (action !== 'added') return null;
      return embed(p, `[${repo}] New collaborator added: ${str(obj(p.member).login)}`, { url: obj(p.member).html_url });
    }
    case 'public':
      return embed(p, `[${repo}] Now open sourced!`, { url: obj(p.repository).html_url });
    case 'discussion': {
      const d = obj(p.discussion);
      if (action === 'created') return embed(p, `[${repo}] New discussion #${str(d.number)}: ${str(d.title)}`, { url: d.html_url, description: preview(d.body), color: COLOR.misc });
      if (action === 'answered') return embed(p, `[${repo}] Discussion answered: #${str(d.number)} ${str(d.title)}`, { url: obj(p.answer).html_url ?? d.html_url, description: preview(obj(p.answer).body), color: COLOR.success });
      return null;
    }
    case 'discussion_comment': {
      if (action !== 'created') return null;
      const d = obj(p.discussion);
      const comment = obj(p.comment);
      return embed(p, `[${repo}] New comment on discussion #${str(d.number)}: ${str(d.title)}`, { url: comment.html_url, description: preview(comment.body), color: COLOR.comment });
    }
    case 'check_run':
    case 'check_suite': {
      if (action !== 'completed') return null;
      const run = obj(event!.toLowerCase() === 'check_run' ? p.check_run : p.check_suite);
      const conclusion = str(run.conclusion) || 'completed';
      const branch = str(run.head_branch) || str(obj(run.check_suite).head_branch);
      const name = str(run.name) || str(obj(run.app).name) || 'Checks';
      const ok = conclusion === 'success' || conclusion === 'neutral' || conclusion === 'skipped';
      return embed(p, `[${repo}] ${name} ${conclusion}${branch ? ` on ${branch}` : ''}`, { url: run.html_url ?? run.details_url, color: ok ? COLOR.success : COLOR.fail });
    }
    default:
      return null;
  }
}
