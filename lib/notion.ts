import "server-only";
import { APIErrorCode, Client, ClientErrorCode, isNotionClientError } from "@notionhq/client";

/**
 * THE ONLY FILE THAT TALKS TO NOTION (SDK v5, Notion API 2025-09-03, which uses data sources).
 *
 * resolveTarget() looks at the database once (cached): it finds the first data source, reads its
 * property names and types, and maps them to what we need (title, status, owner, due date, meeting).
 * Missing owner / due date / meeting properties are ADDED to the data source (additive only), so
 * tasks always carry those fields. Nothing about existing properties or pages is changed.
 */

export class NotionError extends Error {
  constructor(
    message: string,
    readonly kind: "config" | "access" | "rate_limit" | "network" | "validation" | "unknown",
  ) {
    super(message);
    this.name = "NotionError";
  }
}

type OwnerType = "people" | "select" | "multi_select" | "rich_text";
type MeetingType = "rich_text" | "select" | "multi_select";

interface Target {
  dataSourceId: string;
  databaseUrl: string | null;
  title: string;
  status: { name: string; type: "status" | "select"; option: string; doneOption: string } | null;
  owner: { name: string; type: OwnerType } | null;
  due: { name: string } | null;
  meeting: { name: string; type: MeetingType } | null;
  /** Notion workspace people by lower-cased name and first name (for a "people" owner property). */
  people: Map<string, string>;
}

export interface NotionTask {
  title: string;
  owner: string;
  dueDate: string; // YYYY-MM-DD
  meetingTitle: string;
  meetingDate: string;
  quote: string | null;
  /** Done tasks get the "Done" status option. */
  done?: boolean;
}

const CACHE_MS = 10 * 60_000;
let cache: { target: Target; at: number } | null = null;
let client: Client | null = null;

function notion(): Client {
  const auth = process.env.NOTION_TOKEN?.trim();
  if (!auth) throw new NotionError("NOTION_TOKEN is missing. Add it to .env.local and restart the app.", "config");
  client ??= new Client({ auth, timeoutMs: 20_000 }); // SDK default API version: 2025-09-03
  return client;
}

function databaseId(): string {
  const id = process.env.NOTION_DATABASE_ID?.trim();
  if (!id) throw new NotionError("NOTION_DATABASE_ID is missing. Add it to .env.local and restart the app.", "config");
  return id;
}

// Loose shape of a data source property (we only read name/type/options).
interface PropSchema {
  type: string;
  status?: { options: { name: string }[]; groups: { name: string; option_ids: string[] }[] };
  select?: { options: { name: string }[] };
}

const OWNER_NAME = /owner|assignee|assigned|responsible|person|who/i;
const DUE_NAME = /due|deadline/i;
const MEETING_NAME = /meeting/i;

function pick(props: [string, PropSchema][], nameRe: RegExp, types: string[]) {
  return props.find(([name, p]) => nameRe.test(name) && types.includes(p.type));
}

function mapProperties(properties: Record<string, PropSchema>) {
  const props = Object.entries(properties);
  const title = props.find(([, p]) => p.type === "title")?.[0];
  if (!title) throw new NotionError("The Notion database has no title property.", "validation");

  let status: Target["status"] = null;
  const statusProp = props.find(([name, p]) => p.type === "status" && /status/i.test(name)) ?? props.find(([, p]) => p.type === "status");
  if (statusProp?.[1].status) {
    const { options: opts, groups } = statusProp[1].status;
    const options = opts.map((o) => o.name);
    const todo = options.find((o) => /^to[\s-]?do$/i.test(o)) ?? options.find((o) => /not started|to[\s-]?do|backlog/i.test(o)) ?? options[0];
    const completeGroup = groups.find((g) => /complete|done/i.test(g.name));
    const done =
      options.find((o) => /^done$/i.test(o)) ??
      options.find((o) => /complete|finished|closed/i.test(o)) ??
      opts.find((o) => completeGroup?.option_ids.includes((o as { id?: string }).id ?? ""))?.name ??
      options[options.length - 1];
    if (todo) status = { name: statusProp[0], type: "status", option: todo, doneOption: done ?? todo };
  } else {
    const selectStatus = props.find(([name, p]) => p.type === "select" && /status/i.test(name));
    if (selectStatus) status = { name: selectStatus[0], type: "select", option: "To Do", doneOption: "Done" };
  }

  const owner = pick(props, OWNER_NAME, ["people", "select", "multi_select", "rich_text"]);
  const due = pick(props, DUE_NAME, ["date"]) ?? props.find(([, p]) => p.type === "date");
  const meeting = pick(props, MEETING_NAME, ["rich_text", "select", "multi_select"]);

  return {
    title,
    status,
    owner: owner ? { name: owner[0], type: owner[1].type as OwnerType } : null,
    due: due ? { name: due[0] } : null,
    meeting: meeting ? { name: meeting[0], type: meeting[1].type as MeetingType } : null,
  };
}

async function resolveTarget(): Promise<Target> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.target;
  const api = notion();

  const db = (await api.databases.retrieve({ database_id: databaseId() })) as unknown as {
    url?: string;
    data_sources?: { id: string }[];
  };
  const dataSourceId = db.data_sources?.[0]?.id;
  if (!dataSourceId) throw new NotionError("That Notion database has no data source to add tasks to.", "validation");

  const ds = (await api.dataSources.retrieve({ data_source_id: dataSourceId })) as unknown as {
    properties: Record<string, PropSchema>;
  };
  let mapped = mapProperties(ds.properties);

  // Add the columns we need but don't have yet (additive; existing properties are untouched).
  const add: Record<string, unknown> = {};
  if (!mapped.owner) add.Owner = { select: {} };
  if (!mapped.due) add["Due date"] = { date: {} };
  if (!mapped.meeting) add.Meeting = { rich_text: {} };
  if (Object.keys(add).length > 0) {
    const updated = (await api.dataSources.update({
      data_source_id: dataSourceId,
      properties: add as never,
    })) as unknown as { properties?: Record<string, PropSchema> };
    mapped = mapProperties(updated.properties ?? ds.properties);
  }

  const people = new Map<string, string>();
  if (mapped.owner?.type === "people") {
    const users = await api.users.list({ page_size: 100 });
    for (const u of users.results) {
      if (u.type !== "person" || !u.name) continue;
      const name = u.name.toLowerCase();
      people.set(name, u.id);
      people.set(name.split(/\s+/)[0], u.id);
    }
  }

  const target: Target = { dataSourceId, databaseUrl: db.url ?? null, ...mapped, people };
  cache = { target, at: Date.now() };
  return target;
}

function text(content: string) {
  // Notion caps a rich text item at 2000 characters.
  return [{ type: "text" as const, text: { content: content.slice(0, 1990) } }];
}

function buildProperties(t: Target, task: NotionTask): Record<string, unknown> {
  const props: Record<string, unknown> = { [t.title]: { title: text(task.title) } };
  if (t.status) {
    const option = task.done ? t.status.doneOption : t.status.option;
    props[t.status.name] = t.status.type === "status" ? { status: { name: option } } : { select: { name: option } };
  }
  if (t.due) props[t.due.name] = { date: { start: task.dueDate } };
  if (t.owner) {
    const name = task.owner.replace(/,/g, " ").trim(); // commas aren't allowed in select option names
    if (t.owner.type === "people") {
      const id = t.people.get(name.toLowerCase()) ?? t.people.get(name.toLowerCase().split(/\s+/)[0]);
      props[t.owner.name] = { people: id ? [{ id }] : [] };
    } else if (t.owner.type === "select") props[t.owner.name] = { select: { name } };
    else if (t.owner.type === "multi_select") props[t.owner.name] = { multi_select: [{ name }] };
    else props[t.owner.name] = { rich_text: text(task.owner) };
  }
  if (t.meeting) {
    const name = task.meetingTitle.replace(/,/g, " ").slice(0, 100);
    if (t.meeting.type === "select") props[t.meeting.name] = { select: { name } };
    else if (t.meeting.type === "multi_select") props[t.meeting.name] = { multi_select: [{ name }] };
    else props[t.meeting.name] = { rich_text: text(task.meetingTitle) };
  }
  return props;
}

function paragraph(content: string) {
  return { object: "block" as const, type: "paragraph" as const, paragraph: { rich_text: text(content) } };
}

function pageBody(task: NotionTask) {
  const blocks: unknown[] = [];
  if (task.quote) {
    blocks.push({ object: "block", type: "heading_3", heading_3: { rich_text: text("What was said in the meeting") } });
    blocks.push({ object: "block", type: "quote", quote: { rich_text: text(task.quote) } });
  }
  blocks.push(paragraph(`From "${task.meetingTitle}" on ${task.meetingDate}. Owner: ${task.owner}. Due: ${task.dueDate}.`));
  blocks.push(paragraph("Created by Minutes to Momentum after the meeting notes were approved."));
  return blocks;
}

/**
 * Looks for a page that is already in Notion for the same task + meeting (e.g. an earlier attempt
 * whose response was lost, or an earlier demo take). Only used when the meeting is a property,
 * so tasks with the same name from different meetings are never merged.
 */
async function findExisting(t: Target, task: NotionTask): Promise<{ id: string; url: string } | null> {
  if (!t.meeting) return null;
  const meetingFilter =
    t.meeting.type === "rich_text"
      ? { property: t.meeting.name, rich_text: { equals: task.meetingTitle } }
      : t.meeting.type === "select"
        ? { property: t.meeting.name, select: { equals: task.meetingTitle.replace(/,/g, " ") } }
        : { property: t.meeting.name, multi_select: { contains: task.meetingTitle.replace(/,/g, " ") } };
  const res = await notion().dataSources.query({
    data_source_id: t.dataSourceId,
    page_size: 1,
    filter: { and: [{ property: t.title, title: { equals: task.title } }, meetingFilter] } as never,
  });
  const page = res.results[0] as { id: string; url?: string } | undefined;
  return page ? { id: page.id, url: page.url ?? "" } : null;
}

export async function createTaskPage(task: NotionTask): Promise<{ pageId: string; url: string; adopted: boolean }> {
  try {
    const t = await resolveTarget();
    const existing = await findExisting(t, task);
    if (existing) return { pageId: existing.id, url: existing.url, adopted: true };
    const page = (await notion().pages.create({
      parent: { type: "data_source_id", data_source_id: t.dataSourceId },
      properties: buildProperties(t, task) as never,
      children: pageBody(task) as never,
    })) as { id: string; url?: string };
    return { pageId: page.id, url: page.url ?? "", adopted: false };
  } catch (err) {
    throw toNotionError(err);
  }
}

export async function updateTaskPage(pageId: string, task: NotionTask, note: string | null): Promise<{ url: string }> {
  try {
    const t = await resolveTarget();
    const page = (await notion().pages.update({ page_id: pageId, properties: buildProperties(t, task) as never })) as { url?: string };
    if (note) await notion().blocks.children.append({ block_id: pageId, children: [paragraph(note)] as never });
    return { url: page.url ?? "" };
  } catch (err) {
    throw toNotionError(err);
  }
}

/** Only flips the Status property (To Do <-> Done). */
export async function setTaskPageDone(pageId: string, done: boolean): Promise<void> {
  try {
    const t = await resolveTarget();
    if (!t.status) return;
    const option = done ? t.status.doneOption : t.status.option;
    await notion().pages.update({
      page_id: pageId,
      properties: { [t.status.name]: t.status.type === "status" ? { status: { name: option } } : { select: { name: option } } } as never,
    });
  } catch (err) {
    throw toNotionError(err);
  }
}

export async function notionDatabaseUrl(): Promise<string | null> {
  try {
    return (await resolveTarget()).databaseUrl;
  } catch {
    return null;
  }
}

function toNotionError(err: unknown): NotionError {
  if (err instanceof NotionError) return err;
  // Force a fresh schema read next time (the database may have changed).
  cache = null;
  if (isNotionClientError(err)) {
    switch (err.code) {
      case APIErrorCode.Unauthorized:
        return new NotionError("Notion rejected the token. Check NOTION_TOKEN in .env.local.", "config");
      case APIErrorCode.ObjectNotFound:
      case APIErrorCode.RestrictedResource:
        return new NotionError(
          "Notion can't see that database. Open it in Notion, then ... menu > Connections, and add your integration.",
          "access",
        );
      case APIErrorCode.RateLimited:
        return new NotionError("Notion is rate limiting us. Wait a few seconds and press Retry.", "rate_limit");
      case APIErrorCode.ValidationError:
        return new NotionError(`Notion didn't accept the task: ${err.message}`, "validation");
      case ClientErrorCode.RequestTimeout:
        return new NotionError("Notion took too long to answer. Press Retry.", "network");
      case APIErrorCode.InternalServerError:
      case APIErrorCode.ServiceUnavailable:
        return new NotionError("Notion is having trouble right now. Press Retry in a moment.", "network");
    }
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|network/i.test(message)) {
    return new NotionError("Couldn't reach Notion. Check your internet connection and press Retry.", "network");
  }
  return new NotionError(`Notion error: ${message}`, "unknown");
}
