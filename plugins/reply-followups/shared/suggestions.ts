export const ROW_KIND = "reply-followups";
const HEADING = "**Possible next prompts**";

export const INSTRUCTIONS = `For conversational replies only. Omit suggestions when the user or runtime requests an exact output format, a schema, or a reply without extra text.

When your final reply clearly points to a useful next step, optionally end it with the following Markdown section:

${HEADING}
- Run the focused tests

Use that exact heading and one or two short plain-text bullets (at most 120 characters each). Write each as a message the user might send in their own language. Only offer concrete next steps grounded in the reply. Omit the section if nothing useful follows, or if the reply already includes an interactive choice or asks a clarifying question. Do not place the section in a code block.`;

export function readSuggestions(text: string): string[] {
  const lines = text.trimEnd().split(/\r?\n/);
  const heading = lines.findLastIndex((line) => line === HEADING);
  if (heading < 0 || (heading > 0 && lines[heading - 1].trim())) return [];
  const bullets = lines.slice(heading + 1);
  if (bullets.length < 1 || bullets.length > 2) return [];

  let fence: string | undefined;
  for (const line of lines.slice(0, heading)) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!match) continue;
    const [, delimiter, suffix] = match;
    if (!fence) fence = delimiter;
    else if (delimiter[0] === fence[0] && delimiter.length >= fence.length && !suffix.trim()) {
      fence = undefined;
    }
  }
  if (fence) return [];

  const prompts = bullets.map((bullet) => (bullet.startsWith("- ") ? bullet.slice(2).trim() : ""));
  if (
    prompts.some(
      (prompt) =>
        !prompt || prompt.length > 120 || /[\p{Cc}\p{Bidi_Control}`<>]|\[[^\]]*\]\(/u.test(prompt),
    ) ||
    new Set(prompts.map((prompt) => prompt.toLowerCase())).size !== prompts.length
  )
    return [];
  return prompts;
}
