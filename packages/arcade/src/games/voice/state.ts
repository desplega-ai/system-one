// What each listener gets and is asked: the page's screen and actions, then the clip or the transcript.
import { type Answers, type AudioPart, q, type StatePart } from "@system-one/ai";
import { moods } from "../../acme/app.ts";
import type { Snapshot } from "../../acme/protocol.ts";
import { type Action, NONE } from "./actions.ts";

export const languages = ["english", "spanish", "other"] as const;
export type Language = (typeof languages)[number];

export function questionsFor(actions: readonly Action[]) {
  return {
    action: q.choice<string>("What does the user want the app to do?", {
      ...Object.fromEntries(actions.map((a) => [a.id, a.description])),
      [NONE]: "nothing on this screen: small talk, noise, or a request that no action here can do",
    }),
    language: q.choice("Which language does the user speak?", languages),
    mood: q.choice("How does the user feel, from what they say and how they sound?", moods),
  };
}
export type VoiceQuestions = ReturnType<typeof questionsFor>;
export type VoiceAnswers = Answers<VoiceQuestions>;

/** The input of one listener. Transcript listeners do not get the detected language: it would give the answer away. */
export type Heard = { audio: AudioPart } | { transcript: string };

export function stateFor(view: Snapshot, heard: Heard): StatePart[] {
  const context = {
    app: "Acme, a shop app. The user talks to it to move around and get things done.",
    screen: view.screen,
    visibleItems: view.visible,
  };
  return "audio" in heard ? [{ ...context, input: "The user's voice is in the audio clip." }, heard.audio] : [{ ...context, userSaid: heard.transcript }];
}

/** The follow-up after "Did you mean X or Y?". Only the driver answers it. */
export function pickQuestion(first: Action, second: Action) {
  return {
    pick: q.choice("The app asked the user to choose between two actions. Which one did the user choose?", {
      first: first.description,
      second: second.description,
      neither: "neither of them, or something else",
    }),
  };
}
