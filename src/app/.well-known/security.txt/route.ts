import { NextResponse } from "next/server";

export const dynamic = "force-static";

export function GET() {
  const body = `# SerikaCord Security Policy
# https://www.rfc-editor.org/rfc/rfc9116

Contact: mailto:security@serika.dev
Expires: 2027-07-14T00:00:00.000Z
Preferred-Languages: en
Canonical: https://serika.chat/.well-known/security.txt
Policy: https://github.com/serika-dev/SerikaCord/blob/main/SECURITY.md
`;

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
