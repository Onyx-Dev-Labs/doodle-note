import { helpGuides } from "../../../content/help-guides";
import { buildHelpSearchIndex } from "../../../lib/help-search";

export const dynamic = "force-static";

export function GET() {
  return Response.json(buildHelpSearchIndex(helpGuides));
}
