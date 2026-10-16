// Turns the tools of the page into a finite list of actions, so one System One choice can pick one.
// Generic over WebMCP-style tools: it reads only the name, the description and the input schema.
import type { ChoiceAnswer, RefusalAnswer } from "@system-one/ai";
import type { ToolInfo } from "../../acme/tools.ts";

/** Tools the game sets from how the user talks (language, mood), not from what they ask for. */
export const adaptationTools: readonly string[] = ["set_language", "set_theme"];
/** The option for "the app should do nothing". */
export const NONE = "none";

export type Action = {
  /** The option id: the tool name, plus the value for a tool with one enum input ("go_to.orders"). */
  id: string;
  tool: string;
  /** For people, in the page language. */
  title: string;
  /** What it does, in English, as a request: "open the list of orders". */
  request: string;
  /** For the models: the request, plus what the user must give for a text input. */
  description: string;
  input: Record<string, string>;
  /** A free-text input. The cheap text model fills it from the transcript. */
  text?: { name: string; description: string };
};

type Property = { type?: string; description?: string; oneOf?: { const: string; title?: string; description?: string }[] };

/**
 * One action per tool without inputs or with one text input, and one per value of a tool with one
 * enum input. Tools with more inputs are left out: their choices would multiply.
 */
export function actionsFrom(tools: readonly ToolInfo[]): Action[] {
  const actions: Action[] = [];
  for (const tool of tools) {
    if (adaptationTools.includes(tool.name)) continue;
    const properties = Object.entries((tool.inputSchema.properties ?? {}) as Record<string, Property>);
    if (properties.length > 1) continue;
    const [property] = properties;
    if (property?.[1].oneOf) {
      const [name, schema] = property;
      for (const value of schema.oneOf!) {
        const request = value.description ?? `${tool.description} (${name}: ${value.const})`;
        actions.push({ id: `${tool.name}.${value.const}`, tool: tool.name, title: `${tool.title}: ${value.title ?? value.const}`, request, description: request, input: { [name]: value.const } });
      }
    } else if (property && property[1].type === "string") {
      const [name, schema] = property;
      const about = schema.description ?? name;
      actions.push({
        id: tool.name,
        tool: tool.name,
        title: tool.title,
        request: tool.description,
        description: `${tool.description} The user gives ${about}.`,
        input: {},
        text: { name, description: about },
      });
    } else if (!property) {
      actions.push({ id: tool.name, tool: tool.name, title: tool.title, request: tool.description, description: tool.description, input: {} });
    }
  }
  return actions;
}

/**
 * The did-you-mean rule: the top action is under 60%, or the top two are within 15 points.
 * Returns the two candidate ids, or null when the answer is clear. A top "none" is not a question.
 */
export function uncertain(answer: ChoiceAnswer<string> | RefusalAnswer): [string, string] | null {
  if (answer.type === "refusal") return null;
  const ranked = Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1]);
  const [first, second] = ranked;
  if (!first || !second || first[0] === NONE || second[0] === NONE) return null;
  return first[1] < 0.6 || first[1] - second[1] < 0.15 ? [first[0], second[0]] : null;
}

/** The prompt that asks the cheap model for one text input, in the user's words. */
export function fillPrompt(action: Action, said: string): { system: string; prompt: string } {
  return {
    system: "You fill one input of an app action from what the user said. Reply with the value only: no quotes, no explanation. Keep the user's language.",
    prompt: `Action: ${action.description}\nInput: ${action.text?.description}\nThe user said: "${said}"\nValue:`,
  };
}

/** Cleans the model's text into an input value: one line, no quotes, at most 200 characters. */
export function cleanValue(text: string): string {
  return text.split("\n")[0]!.trim().replace(/\.$/, "").replace(/^["'“”«]+|["'“”»]+$/g, "").trim().slice(0, 200);
}
