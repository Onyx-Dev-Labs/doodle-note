import { MeetingsLibrary, type LibrarySearchParams } from "./meetings-library";

export const metadata = { title: "Meetings — DoodleNote" };

export default async function MeetingsPage({
  searchParams,
}: {
  searchParams: Promise<LibrarySearchParams>;
}) {
  return <MeetingsLibrary searchParams={await searchParams} />;
}
