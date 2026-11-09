import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getHelpNavigation } from "../../content/help-guides";
import { HelpShell } from "./help-shell";
import "./help.css";

export const metadata: Metadata = {
  title: {
    default: "Help & guides | DoodleNote",
    template: "%s | DoodleNote Help",
  },
  description:
    "A little guidance for your next good idea. Learn to record meetings, make useful notes, use Bark dictation, and set up Cloud Sync.",
};

export default function HelpLayout({ children }: { children: ReactNode }) {
  return <HelpShell groups={getHelpNavigation()}>{children}</HelpShell>;
}
