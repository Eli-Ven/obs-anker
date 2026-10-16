import { end, overlaps, parse, protectedRanges, start, walk } from "./document";

export function contextQuote(
  text: string,
  from: number,
  to: number,
  input: string,
): { insert: string; anchor: number; head: number } | undefined {
  if (input.length !== 1) return;
  const pair = ["“”", "‘’", "「」", "『』"].find((p) => p.includes(input));
  if (!pair) return;
  const tree = parse(text),
    blocked = protectedRanges(text, true, true, tree);
  if (
    overlaps(blocked, from, Math.max(from + 1, to)) ||
    (text.slice(0, from).match(/\\+$/)?.[0].length ?? 0) % 2
  )
    return;
  const [left, right] = pair;
  if (from !== to)
    return {
      insert: left + text.slice(from, to) + right,
      anchor: from + 1,
      head: to + 1,
    };
  if (text[from] === right)
    return { insert: "", anchor: from + 1, head: from + 1 };

  // Read the current Markdown paragraph, including soft/hard line breaks.
  // An unfinished quote in a previous paragraph must not affect a new one.
  let beginning = from;
  walk(tree, (node) => {
    if (
      (node.type === "paragraph" || node.type === "heading") &&
      start(node) <= from &&
      end(node) >= from
    )
      beginning = start(node);
  });
  let depth = 0;
  for (let i = beginning; i < from; i++) {
    if (text[i] === "\\") i++;
    else if (!overlaps(blocked, i)) {
      if (text[i] === left) depth++;
      else if (text[i] === right) depth = Math.max(0, depth - 1);
    }
  }
  return {
    insert: depth ? right : pair,
    anchor: from + 1,
    head: from + 1,
  };
}
