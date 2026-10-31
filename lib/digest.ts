import "server-only";
import { z } from "zod";
import { generateJson } from "./ai";
import { dueLabel, formatShort } from "./dates";
import { personFacts, saveDigest, savedDigest, type PersonFacts, type SavedDigest } from "./queries";

/**
 * Weekly digest for one person: ONE Gemini call (label "digest") turns their facts into a short,
 * friendly note that pastes cleanly into Slack or email. Saved per person per day, so opening it
 * again the same day never calls the AI. People with nothing going on get a note without an AI call.
 */

const digestSchema = z.object({
  text: z.string().describe("The whole digest as plain text with line breaks. Bullets start with '• '."),
});

const SYSTEM = `You write a short, friendly weekly digest for one teammate, based only on the facts given.

FORMAT (plain text that pastes cleanly into Slack or email)
- First line: "Hi <name>," then a one-sentence overview of their week.
- Then short sections. Each section is a label on its own line followed by bullet lines that start with "• ".
  Use these labels, in this order, and skip any section with no facts: "Overdue", "Coming up", "Done this week", "Decisions that affect you", "To discuss".
- End with one short, warm closing line.
- No markdown (no #, no **), no emoji, no exclamation marks in every line. Under 150 words.

RULES
- Use only the facts given. Never invent tasks, dates, people or decisions.
- Keep dates as given ("due tomorrow", "2 days overdue", "Fri 7 Nov").
- Be encouraging but plain; overdue items are stated calmly with a nudge, not scolded.`;

function lines(title: string, items: string[]) {
  return items.length ? `${title}:\n${items.map((i) => `- ${i}`).join("\n")}` : `${title}: none`;
}

function factsPrompt(f: PersonFacts, today: string) {
  const due = (d: string | null) => (d ? dueLabel(d, today).text.replace(/^Due /, "due ").toLowerCase() : "no deadline");
  return `Person: ${f.name}
Today: ${formatShort(today)}

${lines("Overdue tasks", f.overdue.map((t) => `${t.title} (${due(t.dueDate)}, from ${t.meetingTitle})`))}

${lines("Open tasks", f.open.map((t) => `${t.title} (${due(t.dueDate)}, from ${t.meetingTitle})`))}

${lines("Completed in the last 7 days", f.doneThisWeek.map((t) => t.title))}

${lines("Decisions from recent meetings they were in or own", f.decisions.map((d) => `${d.text} (${d.meetingTitle}, ${formatShort(d.meetingDate)})`))}

${lines("Open items to discuss", f.discuss.map((d) => `${d.explanation} (raised in ${d.meetingTitle})`))}`;
}

export function digestFacts(name: string, today: string) {
  return personFacts(name, today);
}

export function existingDigest(name: string, today: string): SavedDigest | null {
  return savedDigest(name, today);
}

export async function generateDigest(
  name: string,
  today: string,
  opts: { regenerate?: boolean } = {},
): Promise<SavedDigest & { fromCache: boolean }> {
  if (!opts.regenerate) {
    const saved = savedDigest(name, today);
    if (saved) return { ...saved, fromCache: true };
  }
  const facts = personFacts(name, today);
  if (!facts) throw new Error(`No one called ${name} in memory.`);

  const empty = !facts.overdue.length && !facts.open.length && !facts.doneThisWeek.length && !facts.decisions.length && !facts.discuss.length;
  const content = empty
    ? `Hi ${facts.name},\nNothing on your plate from recent meetings this week: no open tasks, no deadlines and nothing waiting to be discussed.\nEnjoy the quiet week.`
    : (
        await generateJson({ label: "digest", system: SYSTEM, prompt: factsPrompt(facts, today), schema: digestSchema, temperature: 0.4, refresh: opts.regenerate })
      ).text.trim();

  saveDigest(facts.name, today, content);
  return { ...(savedDigest(facts.name, today) ?? { content, createdAt: "" }), fromCache: false };
}
