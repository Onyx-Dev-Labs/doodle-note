import {
  MeetingsLibrary,
  type LibrarySearchParams,
} from "../meetings-library";

export const metadata = { title: "Shared meetings — DoodleNote" };

export default async function SharedMeetingsPage({
  searchParams,
}: {
  searchParams: Promise<LibrarySearchParams>;
}) {
  return (
    <MeetingsLibrary searchParams={await searchParams} sharedOnly />
  );
}
