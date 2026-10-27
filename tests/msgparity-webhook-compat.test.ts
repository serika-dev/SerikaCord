import { describe, expect, test } from "bun:test";
import {
  githubWebhookMessage, parseCompatBody, slackColor, slackToMarkdown, slackWebhookMessage,
} from "../src/lib/botapi/webhookCompat";

const sender = { login: "octocat", html_url: "https://github.com/octocat", avatar_url: "https://avatars.githubusercontent.com/u/1" };
const repository = { full_name: "octo/repo", html_url: "https://github.com/octo/repo" };

describe("Slack-compatible webhooks", () => {
  test("mrkdwn to markdown", () => {
    expect(slackToMarkdown("See <https://x.dev|the docs> and <https://y.dev>")).toBe("See [the docs](https://x.dev) and https://y.dev");
    expect(slackToMarkdown("*bold* and ~gone~")).toBe("**bold** and ~~gone~~");
    expect(slackToMarkdown("a &lt;b&gt; &amp; c")).toBe("a <b> & c");
    expect(slackToMarkdown("<!here> deploy")).not.toContain("@here");
  });
  test("colors", () => {
    expect(slackColor("good")).toBe(0x2eb886);
    expect(slackColor("#ff0000")).toBe(0xff0000);
    expect(slackColor("f00")).toBe(0xff0000);
    expect(slackColor("nope")).toBeUndefined();
  });
  test("payload -> execute body", () => {
    const m = slackWebhookMessage({
      text: "Deployed",
      username: "CI",
      icon_url: "https://ci.example/icon.png",
      attachments: [{
        pretext: "Build 42",
        color: "danger",
        title: "Failed",
        title_link: "https://ci.example/42",
        text: "tests failed",
        fields: [{ title: "Branch", value: "main", short: true }],
        footer: "ci",
        ts: 1700000000,
        image_url: "javascript:alert(1)",
      }],
    });
    expect(m.content).toBe("Deployed\nBuild 42");
    expect(m.username).toBe("CI");
    expect(m.avatar_url).toBe("https://ci.example/icon.png");
    expect(m.embeds?.[0]).toMatchObject({ color: 0xa30200, title: "Failed", url: "https://ci.example/42", description: "tests failed", fields: [{ name: "Branch", value: "main", inline: true }], footer: { text: "ci" } });
    expect(m.embeds?.[0].image).toBeUndefined();
    expect(m.embeds?.[0].timestamp).toBe(new Date(1700000000 * 1000).toISOString());
  });
  test("form posts carry the JSON in payload", () => {
    expect(parseCompatBody({ payload: JSON.stringify({ text: "hi" }) }).payload).toEqual({ text: "hi" });
    expect(parseCompatBody({ text: "hi" }).payload).toEqual({ text: "hi" });
    expect(parseCompatBody({ payload: "{bad" }).payload).toEqual({});
  });
});

describe("GitHub-compatible webhooks", () => {
  test("push with commits", () => {
    const m = githubWebhookMessage("push", {
      ref: "refs/heads/main",
      compare: "https://github.com/octo/repo/compare/a...b",
      commits: [{ id: "abcdef1234", message: "Fix bug\n\nlong body", url: "https://github.com/octo/repo/commit/abcdef1234", author: { username: "octocat" } }],
      repository,
      sender,
    })!;
    expect(m.username).toBe("GitHub");
    expect(m.embeds![0].title).toBe("[octo/repo:main] 1 new commit");
    expect(m.embeds![0].description).toBe("[`abcdef1`](https://github.com/octo/repo/commit/abcdef1234) Fix bug - octocat");
    expect(m.embeds![0].author).toMatchObject({ name: "octocat" });
  });
  test("empty push and ping are ignored", () => {
    expect(githubWebhookMessage("push", { ref: "refs/heads/x", commits: [], repository, sender })).toBeNull();
    expect(githubWebhookMessage("ping", { repository, sender })).toBeNull();
    expect(githubWebhookMessage("unknown_event", { repository, sender })).toBeNull();
  });
  test("issues / pull requests", () => {
    const issue = { number: 7, title: "Crash", html_url: "https://github.com/octo/repo/issues/7", body: "steps" };
    expect(githubWebhookMessage("issues", { action: "opened", issue, repository, sender })!.embeds![0].title).toBe("[octo/repo] Issue opened: #7 Crash");
    expect(githubWebhookMessage("issues", { action: "labeled", issue, repository, sender })).toBeNull();
    const pr = { number: 9, title: "Feature", html_url: "https://github.com/octo/repo/pull/9", merged: true };
    expect(githubWebhookMessage("pull_request", { action: "closed", pull_request: pr, repository, sender })!.embeds![0].title).toBe("[octo/repo] Pull request merged: #9 Feature");
    expect(githubWebhookMessage("issue_comment", { action: "created", issue: { ...issue, pull_request: {} }, comment: { body: "lgtm", html_url: "https://github.com/c" }, repository, sender })!.embeds![0].title)
      .toBe("[octo/repo] New comment on pull request #7: Crash");
  });
  test("release, star, fork, create", () => {
    expect(githubWebhookMessage("release", { action: "published", release: { tag_name: "v1.0", html_url: "https://github.com/r" }, repository, sender })!.embeds![0].title).toBe("[octo/repo] New release published: v1.0");
    expect(githubWebhookMessage("star", { action: "created", repository, sender })!.embeds![0].title).toBe("[octo/repo] New star added");
    expect(githubWebhookMessage("fork", { forkee: { full_name: "me/repo", html_url: "https://github.com/me/repo" }, repository, sender })!.embeds![0].url).toBe("https://github.com/me/repo");
    expect(githubWebhookMessage("create", { ref: "v2", ref_type: "tag", repository, sender })!.embeds![0].title).toBe("[octo/repo] New tag created: v2");
    expect(githubWebhookMessage("delete", { ref: "old", ref_type: "branch", repository, sender })!.embeds![0].title).toBe("[octo/repo] Branch deleted: old");
  });
  test("long text is clipped", () => {
    const issue = { number: 1, title: "x".repeat(400), body: "y".repeat(5000), html_url: "https://github.com/i" };
    const e = githubWebhookMessage("issues", { action: "opened", issue, repository, sender })!.embeds![0];
    expect(String(e.title).length).toBeLessThanOrEqual(256);
    expect(String(e.description).length).toBeLessThanOrEqual(500);
  });
});
