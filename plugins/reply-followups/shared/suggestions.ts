export const ROW_KIND = "reply-followups";
export const HEADING = "**Possible next prompts**";
export const MAX_PROMPT_LENGTH = 120;

export const INSTRUCTIONS = `Always end normal conversational replies—including factual Q&A, coding tasks, and replies that use \`\`\`ui, \`\`\`app, or render_ui—with suggested follow-up prompts in this exact trailing Markdown section:

${HEADING}
- Run the focused tests
- How does this compare with the previous approach?

When your reply includes a \`\`\`ui or \`\`\`app block, place this section outside and after the closing fence, and always use this section instead of GenUI FollowUps() inside Card:

\`\`\`ui
Card("Overview", [Metric("Latency", "42 ms")])
\`\`\`

${HEADING}
- How does latency change under peak load?
- Break this down by region

Paseo strips this trailing section and renders it as suggestion chips below your reply (including when sent as the only reply text after calling render_ui). Use short plain-text \`- \` bullets (at most ${MAX_PROMPT_LENGTH} characters each, with no Markdown formatting, backticks, links, or angle brackets), written in the user's language as messages the user might send next. Omit the section only when the user or runtime requests an exact output format, schema, or reply without extra text, or when the reply asks a clarifying question, waits on a \`sh run\` command, or presents an interactive form or choice to submit (such as Button actions, Plan, Decision, Form, or show_card). Never place the section inside a code block.`;

export function readSuggestions(text: string): string[] {
  const lines = text.trimEnd().split(/\r?\n/);
  const heading = lines.findLastIndex((line) => line === HEADING);
  if (heading < 0 || (heading > 0 && lines[heading - 1].trim())) return [];
  const bullets = lines.slice(heading + 1);
  if (bullets.length < 1) return [];

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
        !prompt ||
        prompt.length > MAX_PROMPT_LENGTH ||
        /[\p{Cc}\p{Bidi_Control}`<>]|\[[^\]]*\]\(/u.test(prompt),
    ) ||
    new Set(prompts.map((prompt) => prompt.toLowerCase())).size !== prompts.length
  )
    return [];
  return prompts;
}
