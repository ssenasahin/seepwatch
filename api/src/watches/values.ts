import { isIP } from "node:net";

// What a user types for a watch, turned into the one form it's stored and searched
// in, or a reason it can't be. Lowercased throughout: domains, addresses and GitHub
// logins are all case-insensitive.

// One DNS label: letters, digits and inner hyphens, at most 63 characters.
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
// GitHub logins: letters, digits and single inner hyphens, at most 39 characters.
const GITHUB_LOGIN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/;
// The part before the @ that real mail systems accept; quoted forms aren't worth it.
const LOCAL_PART = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}$/;

export type Parsed = { value: string } | { problem: string };

export function parseDomain(input: string): Parsed {
  // People paste URLs and addresses; take the host out of them.
  let host = input.trim().toLowerCase();
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/[/?#].*$/, "");
  host = host.replace(/^\*\./, "").replace(/\.$/, "");
  if (isIP(host)) return { problem: "Enter a domain name; an IP address can't be verified" };
  const labels = host.split(".");
  if (
    host.length > 253 ||
    labels.length < 2 ||
    !labels.every((l) => LABEL.test(l)) ||
    /^\d+$/.test(labels.at(-1)!)
  ) {
    return { problem: "Enter a domain like example.com" };
  }
  return { value: host };
}

export function parseEmail(input: string): Parsed & { domain?: string } {
  const text = input.trim().toLowerCase();
  const at = text.lastIndexOf("@");
  if (at < 1) return { problem: "Enter an address like ops@example.com" };
  const local = text.slice(0, at);
  const domain = parseDomain(text.slice(at + 1));
  if (!LOCAL_PART.test(local) || local.startsWith(".") || local.endsWith(".")) {
    return { problem: "Enter an address like ops@example.com" };
  }
  if ("problem" in domain) return { problem: "Enter an address like ops@example.com" };
  return { value: `${local}@${domain.value}`, domain: domain.value };
}

export function parseGithubOrg(input: string): Parsed {
  let login = input.trim().toLowerCase();
  login = login.replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\/.*$/, "");
  login = login.replace(/^@/, "");
  if (!GITHUB_LOGIN.test(login)) return { problem: "Enter an organization name like acme" };
  return { value: login };
}

// The verified domain an address is covered by: its own domain or a parent of it, so
// verifying example.com covers ops@mail.example.com too.
export function coveringDomain(addressDomain: string, verified: string[]): string | null {
  const parents = verified.filter((d) => addressDomain === d || addressDomain.endsWith(`.${d}`));
  // The closest one wins, so the address lists under the domain it belongs to.
  return parents.sort((a, b) => b.length - a.length)[0] ?? null;
}
