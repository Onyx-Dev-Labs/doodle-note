import Link from "next/link";

/**
 * Share-panel entry point to team workspaces (DEV-488). It deliberately does
 * NOT move the meeting — meetings stay in the workspace they were recorded
 * in. It only points to team creation and invitations.
 */
export function ShareWithTeamLink() {
  return (
    <div className="mt-4 border-t border-sand pt-3">
      <Link
        href="/app/settings/workspace#create-team"
        className="text-sm font-medium text-sage-deep hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-deep"
      >
        Share with a team →
      </Link>
      <p className="mt-1 text-[11px] leading-relaxed text-stone">
        Create a team workspace and invite people. Teammates see meetings
        recorded into that workspace; this meeting stays where it is.
      </p>
    </div>
  );
}
