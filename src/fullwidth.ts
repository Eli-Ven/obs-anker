// Port of the user's fullwidth_punctuation.py; no Python or clipboard dependency.
const punctuation: Record<string, string> = {
  ",": "，",
  ".": "。",
  "!": "！",
  "?": "？",
  ":": "：",
  ";": "；",
  "(": "（",
  ")": "）",
  "[": "【",
  "]": "】",
  "{": "｛",
  "}": "｝",
};

function balancedEnd(
  text: string,
  start: number,
  opening: string,
  closing: string,
): number | undefined {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === opening) depth++;
    else if (text[i] === closing && --depth === 0) return i + 1;
  }
}

export function fullwidthPunctuation(source: string): string {
  let text = source,
    prefix = "\ue000";
  while (source.includes(prefix)) prefix += "\ue000";
  const protectedText: string[] = [];
  const keyFor = (index: number) => {
    let key = "";
    do {
      key = String.fromCharCode(65 + (index % 26)) + key;
      index = Math.floor(index / 26) - 1;
    } while (index >= 0);
    return prefix + key + "\ue001";
  };
  const save = (value: string) => {
    const ending = value.match(/\r?\n$/)?.[0] || "";
    const key = keyFor(protectedText.length);
    protectedText.push(ending ? value.slice(0, -ending.length) : value);
    return key + ending;
  };
  const shield = (pattern: RegExp) => {
    text = text.replace(pattern, save);
  };
  const yaml = /^---[ \t]*\r?\n[\s\S]*?^---[ \t]*(?:\r?\n|$)/m.exec(text);
  if (yaml?.index === 0) text = save(yaml[0]) + text.slice(yaml[0].length);

  const fence = /^([ \t]*(?:>[ \t]*)*)(`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)/gm;
  let pieces: string[] = [],
    cursor = 0,
    match: RegExpExecArray | null;
  while ((match = fence.exec(text))) {
    const close = new RegExp(
      `^${match[1]}${match[2][0]}{${match[2].length},}[ \\t]*(?:\\r?\\n|$)`,
      "m",
    ).exec(text.slice(fence.lastIndex));
    const end = close
      ? fence.lastIndex + close.index + close[0].length
      : text.length;
    pieces.push(
      text.slice(cursor, match.index),
      save(text.slice(match.index, end)),
    );
    cursor = end;
    fence.lastIndex = end;
    if (end === text.length) break;
  }
  text = pieces.join("") + text.slice(cursor);
  shield(
    /\[(code|pre|noparse|url|img|email|attach|attachment)\s*\][\s\S]*?(?:\[\/\1\s*\]|$)|\[(code|pre|noparse)(?:=[^\]\r\n]*|[ \t]+[^\]\r\n]*)\][\s\S]*?(?:\[\/\2\s*\]|$)/gi,
  );
  shield(/(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g);
  shield(/^(?: {4}|\t)[^\r\n]*/gm);
  shield(/^ {0,3}\[[^\]\r\n]+\]:[^\r\n]*/gm);
  shield(/!?\[\[[^\r\n]*?\]\]/g);

  pieces = [];
  cursor = 0;
  for (let i = 0; i < text.length;) {
    const start = i;
    if (text.startsWith("![", i)) i++;
    if (text[i] !== "[") {
      i++;
      continue;
    }
    const labelEnd = balancedEnd(text, i, "[", "]");
    let end: number | undefined;
    if (labelEnd !== undefined && labelEnd < text.length) {
      if (text[labelEnd] === "(") end = balancedEnd(text, labelEnd, "(", ")");
      else if (text[labelEnd] === "[")
        end = balancedEnd(text, labelEnd, "[", "]");
    }
    if (end !== undefined) {
      pieces.push(text.slice(cursor, start), save(text.slice(start, end)));
      cursor = end;
      i = end;
    } else i++;
  }
  text = pieces.join("") + text.slice(cursor);
  shield(/\[(?:\/?[A-Za-z][A-Za-z0-9_-]*(?:[= \t][^\]\r\n]*)?|\*|\/\*)\]/g);
  shield(
    /^([ \t]*(?:>[ \t]*)*)(?:[-+*]|\p{Nd}+[.)])[ \t]+(?:\[[ xX]\][ \t]*)?/gmu,
  );
  shield(/\\[!"#$%&'()*+,\-./:;<=>?@\[\\\]^_`{|}~]/g);
  text = text.replace(
    /(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/|www\.|mailto:)[^\s<>\[\]`"'，。！？；：（）【】｛｝“”‘’]+/g,
    (value) => {
      let end = value.length;
      while (end) {
        const last = value[end - 1],
          current = value.slice(0, end);
        if (".,;:!?".includes(last)) end--;
        else if (
          last === ")" &&
          (current.match(/\)/g)?.length || 0) >
            (current.match(/\(/g)?.length || 0)
        )
          end--;
        else break;
      }
      return save(value.slice(0, end)) + value.slice(end);
    },
  );
  shield(
    /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}/g,
  );
  shield(/\p{Nd}+(?:[.,]\p{Nd}+)*(?:\.)?/gu);
  shield(/<[^<>\r\n]+>/g);
  text = text.replace(/\.{3,}/g, "……");
  let doubleOpen = true,
    singleOpen = true;
  text = text.replace(
    /[,.!?:;()[\]{}"']/g,
    (char: string, offset: number, input: string) => {
      if (char === '"') {
        doubleOpen = !doubleOpen;
        return doubleOpen ? "”" : "“";
      }
      if (char === "'") {
        if (
          /[a-z0-9]/i.test(input[offset - 1] || "") &&
          /[a-z0-9]/i.test(input[offset + 1] || "")
        )
          return "’";
        singleOpen = !singleOpen;
        return singleOpen ? "’" : "‘";
      }
      return punctuation[char];
    },
  );
  text = text.replace(
    /[ \t]*([，。！？；：、（）【】｛｝“”‘’…])[ \t]*/g,
    (match: string, char: string, offset: number, input: string) => {
      const end = offset + match.length;
      const hardBreak =
        match.endsWith("  ") &&
        (end === input.length || /[\r\n]/.test(input[end]));
      return char + (hardBreak ? "  " : "");
    },
  );
  for (let index = protectedText.length - 1; index >= 0; index--)
    text = text.replaceAll(keyFor(index), () => protectedText[index]);
  return text;
}
