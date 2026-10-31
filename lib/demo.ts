import "server-only";
import { formatSpoken, todayIso } from "./dates";
import { getDb } from "./db";
import { demoDates } from "./demo-sample";

/**
 * Demo memory for a fictional startup (Priya: PM, Rahul: engineer, Amit: marketing, Neha: designer).
 * resetDemoData() wipes all meetings/people/decisions/tasks/conflicts/digests and loads two past
 * meetings whose dates are RELATIVE TO TODAY (a week ago and three days ago), with tasks due
 * tomorrow, two overdue tasks, one completed task and one open item to discuss.
 * The AI cache is kept: re-running the same demo meeting on the same day is instant.
 */

interface DemoTask {
  title: string;
  owner: string;
  due: string;
  quote: string;
  done?: { on: string };
}
interface DemoDecision {
  key: string;
  text: string;
  rationale: string | null;
  topic: string;
  owner?: string;
}
interface DemoMeeting {
  title: string;
  date: string;
  attendees: string[];
  transcript: string;
  clean: string;
  summary: string;
  decisions: DemoDecision[];
  tasks: DemoTask[];
}

function demoMeetings(today: string): DemoMeeting[] {
  const d = demoDates(today);
  const launch = formatSpoken(d.launch);
  return [
    {
      title: "Launch planning",
      date: d.planning,
      attendees: ["Priya", "Rahul", "Amit", "Neha"],
      transcript: `Priya: Okay so launch date, we're locking ${launch}.
Rahul: Works for engineering.
Priya: And from today the scope is frozen. No new features before launch, I'll own that.
Amit: What about dark mode? Users keep asking.
Priya: Dark mode is almost done, so it ships at launch.
Amit: And the free trial, let's do 14 days.
Priya: Rahul, you own the pricing page, have it ready by ${formatSpoken(d.tomorrow)}.
Priya: I'll finalize the launch checklist by ${formatSpoken(d.yesterday)}.
Neha: I'll design the onboarding emails, done by ${formatSpoken(d.tomorrow)}.
Rahul: And I'll set up error monitoring this week.`,
      clean: `Priya: We're locking the launch for ${launch}.
Rahul: That works for engineering.
Priya: From today the scope is frozen: no new features before launch. I'll own that.
Amit: What about dark mode? Users keep asking.
Priya: Dark mode is almost done, so it ships at launch.
Amit: The free trial should be 14 days.
Priya: Rahul owns the pricing page, due ${formatSpoken(d.tomorrow)}. I'll finalize the launch checklist by ${formatSpoken(d.yesterday)}.
Neha: I'll design the onboarding emails by ${formatSpoken(d.tomorrow)}.
Rahul: I'll set up error monitoring this week.`,
      summary: `The team set the launch for ${launch} and froze the scope, with Priya owning the freeze. Dark mode ships at launch and the free trial is 14 days. Rahul owns the pricing page, Priya the launch checklist and Neha the onboarding emails.`,
      decisions: [
        { key: "launch", text: `The product launches on ${launch}.`, rationale: null, topic: "launch date", owner: "Priya" },
        { key: "scope", text: "Scope is frozen: no new features before launch.", rationale: "Protect the launch date.", topic: "scope", owner: "Priya" },
        { key: "dark", text: "Dark mode ships at launch.", rationale: "It is almost done and users keep asking for it.", topic: "dark mode" },
        { key: "trial14", text: "The free trial lasts 14 days.", rationale: null, topic: "free trial", owner: "Amit" },
      ],
      tasks: [
        { title: "Build the pricing page", owner: "Rahul", due: d.tomorrow, quote: `Rahul, you own the pricing page, have it ready by ${formatSpoken(d.tomorrow)}.` },
        { title: "Finalize the launch checklist", owner: "Priya", due: d.yesterday, quote: `I'll finalize the launch checklist by ${formatSpoken(d.yesterday)}.` },
        { title: "Design the onboarding emails", owner: "Neha", due: d.tomorrow, quote: `I'll design the onboarding emails, done by ${formatSpoken(d.tomorrow)}.` },
        { title: "Set up error monitoring", owner: "Rahul", due: d.twoDaysAgo, quote: "And I'll set up error monitoring this week.", done: { on: d.yesterday } },
      ],
    },
    {
      title: "Marketing sync",
      date: d.marketing,
      attendees: ["Priya", "Amit"],
      transcript: `Amit: For pricing I looked at competitors, I think 9 dollars a month is right for launch.
Priya: Agreed, 9 dollars a month.
Amit: And honestly 14 days of trial is long, let's do 7 days.
Priya: Hmm, let's keep that open for now.
Amit: I'll write the launch blog post, I can have it by ${formatSpoken(d.blogDue)}.
Amit: I'll also book the launch webinar slot by ${formatSpoken(d.twoDaysAgo)}.
Priya: And I'll send you the beta invite list by ${formatSpoken(d.tomorrow)}.`,
      clean: `Amit: Based on competitors, $9 a month is right for launch.
Priya: Agreed, $9 a month.
Amit: A 14-day trial is long; let's do 7 days.
Priya: Let's keep that open for now.
Amit: I'll write the launch blog post by ${formatSpoken(d.blogDue)} and book the launch webinar slot by ${formatSpoken(d.twoDaysAgo)}.
Priya: I'll send you the beta invite list by ${formatSpoken(d.tomorrow)}.`,
      summary:
        "The team set the launch price at $9 per month. Amit wants a 7-day trial instead of 14, which is still open. Amit owns the blog post and the webinar booking; Priya sends the beta invite list.",
      decisions: [
        { key: "price", text: "The launch price is $9 per month.", rationale: "In line with competitors.", topic: "pricing", owner: "Amit" },
        { key: "trial7", text: "The free trial lasts 7 days.", rationale: "14 days is longer than people need to decide.", topic: "free trial", owner: "Amit" },
      ],
      tasks: [
        { title: "Write the launch blog post", owner: "Amit", due: d.blogDue, quote: `I'll write the launch blog post, I can have it by ${formatSpoken(d.blogDue)}.` },
        { title: "Book the launch webinar slot", owner: "Amit", due: d.twoDaysAgo, quote: `I'll also book the launch webinar slot by ${formatSpoken(d.twoDaysAgo)}.` },
        { title: "Send the beta invite list to Amit", owner: "Priya", due: d.tomorrow, quote: `And I'll send you the beta invite list by ${formatSpoken(d.tomorrow)}.` },
      ],
    },
  ];
}

export function resetDemoData(today = todayIso()) {
  const db = getDb();
  const run = db.transaction(() => {
    db.exec(`
      DELETE FROM conflicts;
      DELETE FROM decision_conflicts;
      DELETE FROM digests;
      DELETE FROM action_items;
      DELETE FROM decisions;
      DELETE FROM meeting_attendees;
      DELETE FROM meetings;
      DELETE FROM people;
      DELETE FROM sqlite_sequence WHERE name IN ('conflicts', 'decision_conflicts', 'digests', 'action_items', 'decisions', 'meetings', 'people');
    `);

    const insertPerson = db.prepare("INSERT INTO people (name) VALUES (?) ON CONFLICT(name) DO NOTHING");
    const personId = (name: string) => {
      insertPerson.run(name);
      return (db.prepare("SELECT id FROM people WHERE name = ?").get(name) as { id: number }).id;
    };
    const insertMeeting = db.prepare(
      `INSERT INTO meetings (title, meeting_date, source, raw_transcript, clean_transcript, summary, status, created_at)
       VALUES (?, ?, 'paste', ?, ?, ?, 'confirmed', ? || ' 10:00:00')`,
    );
    const insertAttendee = db.prepare("INSERT INTO meeting_attendees (meeting_id, person_id) VALUES (?, ?)");
    const insertDecision = db.prepare(
      `INSERT INTO decisions (meeting_id, text, rationale, topic, owner_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', ? || ' 10:00:00')`,
    );
    const insertTask = db.prepare(
      `INSERT INTO action_items (meeting_id, title, description, owner_id, due_date, status, approved_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ? || ' 10:00:00', ? || ' 10:00:00', ? || ' 16:00:00')`,
    );

    const decisionIds = new Map<string, number>();
    const meetingIds = new Map<string, number>();
    for (const m of demoMeetings(today)) {
      const meetingId = Number(insertMeeting.run(m.title, m.date, m.transcript, m.clean, m.summary, m.date).lastInsertRowid);
      meetingIds.set(m.title, meetingId);
      for (const name of m.attendees) insertAttendee.run(meetingId, personId(name));
      for (const dec of m.decisions) {
        const id = insertDecision.run(meetingId, dec.text, dec.rationale, dec.topic, dec.owner ? personId(dec.owner) : null, m.date).lastInsertRowid;
        decisionIds.set(dec.key, Number(id));
      }
      // Approved back then, not in Notion yet (send them from the Tasks page to demo Notion updates).
      for (const t of m.tasks) {
        insertTask.run(
          meetingId,
          t.title,
          `From the meeting: "${t.quote}"`,
          personId(t.owner),
          t.due,
          t.done ? "done" : "confirmed",
          m.date,
          m.date,
          t.done?.on ?? m.date,
        );
      }
    }

    // One item the team chose to discuss later: the free-trial length.
    db.prepare(
      `INSERT INTO conflicts (meeting_id, type, explanation, new_text, new_decision_id, old_decision_id, resolution, status, created_at)
       VALUES (?, 'contradicting_decision', ?, ?, ?, ?, 'discuss_later', 'open', ? || ' 10:30:00')`,
    ).run(
      meetingIds.get("Marketing sync"),
      "The free trial changes from 14 days to 7 days.",
      "The free trial lasts 7 days.",
      decisionIds.get("trial7"),
      decisionIds.get("trial14"),
      demoDates(today).marketing,
    );
  });
  run();
}
