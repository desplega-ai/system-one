// Missions: what to ask and how to say it. They give each clip a known truth, so models get scores.
// Each mission comes from the actions of the current screen, so it is always possible.
import { type Mood, moods } from "../../acme/app.ts";
import type { Action } from "./actions.ts";
import type { Language, VoiceAnswers } from "./state.ts";

export type Mission = { action: Action; language: Exclude<Language, "other">; mood: Mood; text: string };

const pick = <T>(list: readonly T[], random: () => number) => list[Math.floor(random() * list.length)]!;
const asRequest = (description: string) => description.charAt(0).toLowerCase() + description.slice(1).replace(/\.$/, "");

/** Going back is left out: from the outside it looks like any other screen change. */
export function createMission(actions: readonly Action[], random: () => number = Math.random): Mission {
  const action = pick(
    actions.filter((a) => a.tool !== "go_back"),
    random,
  );
  const language = pick(["english", "spanish"] as const, random);
  const mood = pick(moods, random);
  const what = action.text ? `${asRequest(action.request)} (you choose the words)` : asRequest(action.request);
  return { action, language, mood, text: `Ask the app to ${what}. Speak ${language === "english" ? "English" : "Spanish"}. Sound ${mood}.` };
}

export type Grade = { action: boolean; language: boolean; mood: boolean };

/** A refused answer is wrong. */
export function grade(mission: Mission, answers: VoiceAnswers): Grade {
  const { action, language, mood } = answers;
  return {
    action: action.type === "choice" && action.choice === mission.action.id,
    language: language.type === "choice" && language.choice === mission.language,
    mood: mood.type === "choice" && mood.choice === mission.mood,
  };
}
