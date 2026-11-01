import { describe, expect, it } from "vitest";
import { coveringDomain, parseDomain, parseEmail, parseGithubOrg } from "./values.js";

describe("watch values", () => {
  it("take the host out of whatever was pasted", () => {
    expect(parseDomain("https://www.Example.com/about?x=1")).toEqual({ value: "www.example.com" });
    expect(parseDomain("*.example.com")).toEqual({ value: "example.com" });
    expect(parseDomain("example.com.")).toEqual({ value: "example.com" });
    expect(parseDomain("com")).toHaveProperty("problem");
  });

  it("read addresses with the domain lowercased", () => {
    expect(parseEmail("First.Last+tag@Example.com")).toEqual({
      value: "first.last+tag@example.com",
      domain: "example.com",
    });
    for (const bad of ["@example.com", "ops@", ".ops@example.com", "ops@localhost"]) {
      expect(parseEmail(bad)).toHaveProperty("problem");
    }
  });

  it("read organization names from links and handles", () => {
    expect(parseGithubOrg("@Acme")).toEqual({ value: "acme" });
    expect(parseGithubOrg("https://github.com/acme/website")).toEqual({ value: "acme" });
  });

  it("pick the closest verified domain for an address", () => {
    const verified = ["example.com", "mail.example.com"];
    expect(coveringDomain("mail.example.com", verified)).toBe("mail.example.com");
    expect(coveringDomain("eu.example.com", verified)).toBe("example.com");
    // A look-alike isn't a subdomain.
    expect(coveringDomain("notexample.com", verified)).toBeNull();
  });
});
