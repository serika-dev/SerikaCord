import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, Table } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Bot Verification",
  description:
    "Get your SerikaCord bot verified to scale beyond 100 servers. Requirements, application process, privileged intents, and data deletion.",
  path: "/developers/docs/topics/bot-verification",
  keywords: ["SerikaCord bot verification", "verified bot", "100 servers", "privileged intents"],
});

export default async function BotVerificationDoc() {
  const gt = await getGT();
  return (
    <DocPage title={gt("Bot Verification")} description={gt("Get your bot verified to scale beyond 100 servers.")}>
      <P>
        {gt("Bots that join 100 or more servers must be verified by SerikaCord. This process ensures bots meet quality and security standards before scaling further.")}
      </P>

      <H2 id="when-to-verify">{gt("When to Verify")}</H2>
      <P>
        {gt("You'll receive a notification when your bot approaches 75 servers. At 100 servers, your bot will be prevented from joining new servers until verified.")}
      </P>
      <Table headers={[gt("Server Count"), gt("Status")]} rows={[
        ["0-74", gt("No verification needed")],
        ["75-99", gt("Verification recommended — notification sent")],
        ["100+", gt("Verification required — bot cannot join new servers")],
      ]} />

      <H2 id="requirements">{gt("Verification Requirements")}</H2>
      <UL>
        <li>{gt("Bot must be owned by a verified developer or verified team")}</li>
        <li>{gt("Bot must have a clear description and purpose")}</li>
        <li>{gt("Bot must comply with the SerikaCord Terms of Service and Community Guidelines")}</li>
        <li>{gt("Bot must handle rate limits and errors gracefully")}</li>
        <li>{gt("Bot must not store user data without proper disclosure")}</li>
        <li>{gt("Developer must provide contact information")}</li>
        <li>{gt("If the bot uses privileged intents, justification must be provided")}</li>
      </UL>

      <H2 id="how-to-apply">{gt("How to Apply")}</H2>
      <UL>
        <li>{gt("1. Go to your application's")}{" "}<Strong>{gt("General Information")}</Strong> {gt("page")}</li>
        <li>{gt("2. Click")}{" "}<Strong>{gt("\"Verify Application\"")}</Strong> {gt("when the server count reaches 75+")}</li>
        <li>{gt("3. Fill out the verification form with bot details and intent justifications")}</li>
        <li>{gt("4. Submit and wait for review (typically 1-2 weeks)")}</li>
        <li>{gt("5. You'll be notified via email when verification is approved or if more info is needed")}</li>
      </UL>

      <H2 id="verified-badge">{gt("Verified Badge")}</H2>
      <P>
        {gt("Once verified, your bot will receive a checkmark badge next to its name, indicating it's an official verified bot.")}
      </P>

      <H2 id="team-verification">{gt("Team Verification")}</H2>
      <P>
        {gt("If your bot is owned by a team, the team must also be verified. Team verification requires:")}
      </P>
      <UL>
        <li>{gt("Team name and logo")}</li>
        <li>{gt("Team description")}</li>
        <li>{gt("At least one verified developer on the team")}</li>
        <li>{gt("Compliance with SerikaCord policies")}</li>
      </UL>

      <Callout type="warning" title={gt("Privileged Intents")}>
        {gt("Bots requesting")}{" "}<InlineCode>GUILD_MEMBERS</InlineCode>, <InlineCode>GUILD_PRESENCES</InlineCode>,
        {gt(" or")}{" "}<InlineCode>MESSAGE_CONTENT</InlineCode> {gt("intents must provide detailed justification during verification. Not all bots will be approved for these intents.")}
      </Callout>

      <H2 id="after-verification">{gt("After Verification")}</H2>
      <UL>
        <li>{gt("Your bot can join unlimited servers")}</li>
        <li>{gt("You'll have access to additional analytics in the Developer Portal")}</li>
        <li>{gt("Your bot will appear in the App Directory (if opted in)")}</li>
        <li>{gt("You must maintain compliance — violations can result in losing verification")}</li>
      </UL>

      <H2 id="data-deletion">{gt("Data Deletion")}</H2>
      <P>
        {gt("Verified bots must provide a way for users to request data deletion. This is required for compliance with privacy regulations.")}
      </P>
    </DocPage>
  );
}
