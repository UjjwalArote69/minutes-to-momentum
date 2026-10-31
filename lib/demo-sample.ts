// Client-safe: demo dates (relative to today) shared by the demo seed and the "Try a sample" button.
import { addDaysIso, formatSpoken } from "./dates";

/** Every demo date is relative to the day you load it, so the demo always works. */
export function demoDates(today: string) {
  return {
    today,
    planning: addDaysIso(today, -7), // "Launch planning" meeting
    marketing: addDaysIso(today, -3), // "Marketing sync" meeting
    launch: addDaysIso(today, 30), // decided launch date
    newLaunch: addDaysIso(today, 45), // where the new meeting moves it
    tomorrow: addDaysIso(today, 1),
    yesterday: addDaysIso(today, -1),
    twoDaysAgo: addDaysIso(today, -2),
    blogDue: addDaysIso(today, 20),
  };
}

/** A new meeting that clashes with the demo memory in every way the checker looks for. */
export function demoNewMeeting(today: string) {
  const d = demoDates(today);
  return {
    title: "Launch check-in",
    transcript: `Priya: Okay quick launch check-in. So um, the launch, we're moving it to ${formatSpoken(addDaysIso(d.launch, 10))}. No wait, ${formatSpoken(d.newLaunch)}, the payment flow needs more testing.
Amit: Haan, and pricing, we're going with 12 dollars a month now. 9 was too low for our margins.
Priya: Rahul is out this week, so Neha, can you take over the pricing page? Let's say by next Friday.
Neha: Sure, I'll own it, next Friday works.
Amit: Also customers keep asking for team workspaces, so let's add team workspaces before launch.
Priya: Okay. And someone should write a blog post announcing the launch.
Neha: I'll also set up the launch analytics dashboard in two weeks.`,
  };
}
