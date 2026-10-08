// Markdown files imported as raw strings (webpack `asset/source`, configured in
// next.config.ts). Currently only CHANGELOG.md, for the /changelog page.
declare module "*.md" {
  const content: string;
  export default content;
}
