export function markdownOf(content: unknown): string | null {
  if (
    content &&
    typeof content === "object" &&
    "markdown" in content &&
    typeof (content as { markdown: unknown }).markdown === "string"
  ) {
    return (content as { markdown: string }).markdown;
  }
  return null;
}
