import { describe, expect, it } from "vitest";
import { newFileLines } from "./patch.js";

describe("newFileLines", () => {
  it("numbers added and context lines as they are in the new file", () => {
    const patch = [
      "@@ -1,3 +1,4 @@",
      " first",
      "-old second",
      "+new second",
      "+inserted",
      " third",
      "@@ -20,2 +21,2 @@ function tail() {",
      " twenty-one",
      "+twenty-two",
      "\\ No newline at end of file",
    ].join("\n");
    expect(newFileLines(patch)).toEqual([
      { number: 1, text: "first", added: false },
      { number: 2, text: "new second", added: true },
      { number: 3, text: "inserted", added: true },
      { number: 4, text: "third", added: false },
      { number: 21, text: "twenty-one", added: false },
      { number: 22, text: "twenty-two", added: true },
    ]);
  });

  it("reads a new file's single hunk", () => {
    expect(newFileLines("@@ -0,0 +1 @@\n+only")).toEqual([
      { number: 1, text: "only", added: true },
    ]);
  });
});
