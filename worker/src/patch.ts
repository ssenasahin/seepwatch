// A commit's diff, read as the lines it added, numbered as they are in the new file.
// Removed lines are skipped: a secret a commit deletes was leaked by an earlier one,
// and that commit is where the finding belongs.

export interface PatchLine {
  // The line's number in the file after the commit.
  number: number;
  text: string;
  added: boolean;
}

// Every line of the new file the patch shows: added ones, and the unchanged context
// around them, which is useful when the owner reads the finding.
export function newFileLines(patch: string): PatchLine[] {
  const lines: PatchLine[] = [];
  let next = 0;
  for (const raw of patch.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      next = Number(hunk[1]);
      continue;
    }
    if (next === 0) continue;
    if (raw.startsWith("+")) {
      lines.push({ number: next++, text: raw.slice(1), added: true });
    } else if (raw.startsWith(" ")) {
      lines.push({ number: next++, text: raw.slice(1), added: false });
    }
    // "-" lines aren't in the new file; "\ No newline at end of file" isn't a line.
  }
  return lines;
}
