import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { MeetingCapture } from "./meeting-capture";

export const metadata: Metadata = { title: "New meeting" };

export default function NewMeetingPage() {
  return (
    <>
      <PageHeader
        title="New meeting"
        description="Talk it through or paste a transcript. You get the decisions, the action items, who owns them and when they are due, ready for you to check."
      />
      <MeetingCapture />
    </>
  );
}
