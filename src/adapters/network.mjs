import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { Agent } from "undici";
import { requireThat } from "../utils.mjs";

const blocked4 = new BlockList();
const blocked6 = new BlockList();
for (const [ip, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
])
  blocked4.addSubnet(ip, bits, "ipv4");
for (const [ip, bits] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
  ["2001::", 32],
  ["2002::", 16],
])
  blocked6.addSubnet(ip, bits, "ipv6");
export function isPublicAddress(ip) {
  const family = isIP(ip);
  if (!family) return false;
  if (family === 6 && !/^[23]/i.test(ip)) return false;
  return !(family === 4
    ? blocked4.check(ip, "ipv4")
    : blocked6.check(ip, "ipv6"));
}
export function validateEndpointRequest(endpoint, input, init = {}) {
  const request = new Request(input, init);
  requireThat(
    request.url === endpoint && request.method === "GET",
    "ENDPOINT",
    "Only the catalog GET endpoint can be called.",
  );
  return request;
}
export function endpointFetch(endpoint) {
  const expected = new URL(endpoint);
  requireThat(
    expected.protocol === "https:" &&
      !expected.username &&
      !expected.password &&
      !expected.port &&
      !expected.hash,
    "ENDPOINT",
    "Only exact HTTPS catalog endpoints are permitted.",
  );
  if (isIP(expected.hostname.replace(/^\[|\]$/g, "")))
    requireThat(
      isPublicAddress(expected.hostname.replace(/^\[|\]$/g, "")),
      "ENDPOINT",
      "Private and reserved endpoint addresses are forbidden.",
    );
  const dispatcher = new Agent({
    connect: {
      lookup(host, options, callback) {
        lookup(host, { all: true, verbatim: true })
          .then((addresses) => {
            requireThat(
              addresses.length &&
                addresses.every((a) => isPublicAddress(a.address)),
              "ENDPOINT",
              "DNS resolved to a private or reserved address.",
            );
            if (options.all) callback(null, addresses);
            else callback(null, addresses[0].address, addresses[0].family);
          })
          .catch((error) => callback(error));
      },
    },
  });
  return {
    async fetch(url, init = {}) {
      const request = validateEndpointRequest(endpoint, url, init);
      const response = await fetch(request, {
        method: "GET",
        redirect: "error",
        credentials: "omit",
        signal: AbortSignal.timeout(15_000),
        dispatcher,
      });
      // Bound the body before AgentKit's internal response.clone().json() reads it.
      const bytes = await readBoundedBytes(response);
      const headers = new Headers(response.headers);
      headers.delete("content-encoding");
      headers.delete("content-length");
      return new Response(response.status === 204 ? null : bytes, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    },
    close: () => dispatcher.close(),
  };
}
export async function readBoundedBytes(response, limit = 1_048_576) {
  requireThat(
    Number(response.headers.get("content-length") || 0) <= limit,
    "RESPONSE_TOO_LARGE",
    "Provider response exceeds size limit.",
  );
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      requireThat(
        size <= limit,
        "RESPONSE_TOO_LARGE",
        "Provider response exceeds size limit.",
      );
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel();
    throw error;
  }
  return Buffer.concat(chunks);
}
export async function readBoundedJson(response, limit = 1_048_576) {
  const bytes = await readBoundedBytes(response, limit);
  return bytes.length ? JSON.parse(bytes.toString("utf8")) : null;
}
