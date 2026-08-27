export function GET() {
  const body = [
    "Contact: mailto:team@onyxdev.io",
    "Expires: 2027-08-27T23:59:59Z",
    "Preferred-Languages: en",
    "Canonical: https://www.doodlenote.ai/.well-known/security.txt",
    "Policy: https://github.com/Onyx-Dev-Labs/doodle-note/security/policy",
    "",
  ].join("\r\n");

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
