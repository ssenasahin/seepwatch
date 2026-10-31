// The SSRF guard. A webhook channel makes the server send requests to an address a
// user typed, so without this anyone could point one at the server's own network: the
// database, Redis, or the cloud metadata service that hands out credentials
// (169.254.169.254). It lives here because both the API (when a channel is saved) and
// the worker (before every delivery, since DNS answers can change) need the same rules.
import { lookup } from "node:dns/promises";
import type { LookupAddress, LookupOptions } from "node:dns";
import { BlockList, isIP, type LookupFunction } from "node:net";

const blocked = new BlockList();

const IPV4_RANGES: [string, number][] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, including cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, up to and including broadcast
];

const IPV6_RANGES: [string, number][] = [
  ["::", 96], // unspecified, loopback (::1) and the old IPv4-compatible form
  ["64:ff9b::", 96], // NAT64, which can wrap a private IPv4 address
  ["64:ff9b:1::", 48], // local-use NAT64
  ["100::", 64], // discard
  ["2001::", 32], // Teredo, another IPv4 wrapper
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4, another IPv4 wrapper
  ["fc00::", 7], // unique local, IPv6's private range
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
];

for (const [network, prefix] of IPV4_RANGES) blocked.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of IPV6_RANGES) blocked.addSubnet(network, prefix, "ipv6");

// True only for addresses on the public internet. IPv4 addresses written in IPv6 form
// (::ffff:127.0.0.1) are checked against the IPv4 ranges by BlockList itself.
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  try {
    return !blocked.check(address, family === 4 ? "ipv4" : "ipv6");
  } catch {
    return false;
  }
}

export class UnsafeTargetError extends Error {}

// Looks up every address a host name has. Swappable so tests don't depend on real DNS.
export type ResolveHost = (hostname: string) => Promise<string[]>;

export const resolveHost: ResolveHost = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((r) => r.address);
};

// Returns the host's addresses, or refuses the host. A single private address is
// enough to refuse it: whoever connects next might be handed exactly that one.
export async function resolvePublicHost(
  hostname: string,
  resolve: ResolveHost = resolveHost,
): Promise<string[]> {
  // URL hostnames wrap IPv6 literals in brackets: [::1].
  const host = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;

  if (isIP(host)) {
    if (!isPublicAddress(host)) {
      throw new UnsafeTargetError("That address is on a private or reserved network");
    }
    return [host];
  }

  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    throw new UnsafeTargetError("We couldn't find that host. Check the name for typos");
  }
  if (addresses.length === 0) {
    throw new UnsafeTargetError("We couldn't find that host. Check the name for typos");
  }
  if (!addresses.every(isPublicAddress)) {
    throw new UnsafeTargetError("That host points at a private or reserved network");
  }
  return addresses;
}

// Turns a host name (or IP) into addresses that are safe to connect to, or throws.
// In production that's the SSRF guard; tests swap in one that allows a local server.
export type Resolve = (hostname: string) => Promise<string[]>;

export const USER_AGENT = "Seepwatch/0.1 (+https://github.com/ssenasahin/seepwatch)";

// net.connect's DNS step, replaced with the guard, so the address connected to is the
// one that was checked, not a later DNS answer. Node asks for either every address
// (when it races IPv4 against IPv6) or just one, so answer in the shape it asked for.
export function guardedLookup(resolve: Resolve): LookupFunction {
  return (hostname: string, options: LookupOptions, callback) => {
    resolve(hostname).then(
      (found) => {
        const addresses: LookupAddress[] = found
          .map((address) => ({ address, family: isIP(address) }))
          .filter((a) => !options.family || options.family === a.family);
        if (addresses.length === 0) {
          callback(new Error(`No usable address for ${hostname}`), "");
        } else if (options.all) {
          callback(null, addresses);
        } else {
          callback(null, addresses[0]!.address, addresses[0]!.family);
        }
      },
      (err: Error) => callback(err, ""),
    );
  };
}
