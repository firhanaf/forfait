// apps/web/src/lib/hash.ts
//
// Hashing the invoice document in the browser, so it never leaves the machine.
//
// This is the privacy claim the whole design rests on: the funder verifies that the
// document they were shown is the one that was financed, without the document — or the
// commercial terms inside it — ever being uploaded or published.

/** 20 MB. Invoices are a page; anything larger is a mistake or something else entirely. */
const MAX_BYTES = 20 * 1024 * 1024;

/** "%PDF" — the header every PDF begins with, per ISO 32000. */
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46];

/**
 * Whether the bytes begin with a PDF header.
 *
 * **This is a quality check, not a security control**, and the distinction matters.
 * It reads the file's actual first bytes rather than trusting its name or the `accept`
 * attribute — both of which a drag-and-drop bypasses anyway — so it catches someone
 * dropping a photo by mistake. It does not make a file safe: a perfectly valid PDF can
 * carry a malicious payload, and this says nothing about that.
 *
 * Nothing here defends a server, because a client cannot. Anything that later parses,
 * stores, or serves these files has to validate them where it consumes them; an attacker
 * posting to that endpoint never opens this page at all.
 *
 * What it does protect is the audit trail's meaning. The trail attests to "the document
 * the funder was shown". Hashing a screenshot, or an empty file, produces a perfectly
 * valid hash of something that is not an invoice, and the attestation becomes hollow
 * without anything appearing to be wrong.
 */
export function looksLikePdf(bytes: Uint8Array): boolean {
  if (bytes.length < PDF_MAGIC.length) return false;
  return PDF_MAGIC.every((b, i) => bytes[i] === b);
}

/**
 * SHA-256 of raw bytes, lowercase hex, prefixed with the algorithm.
 *
 * The format is fixed by `scripts/audit-trail.ts`, which publishes
 *
 *   'sha256:' + createHash('sha256').update(fileBytes).digest('hex')
 *
 * Both sides must hash the file's raw bytes and encode them as lowercase hex. Any
 * divergence — an encoding change, a JSON envelope, trimming whitespace — means a
 * document hashed here will not match the same document hashed by the platform, and
 * every trail will read as tampered while nothing is actually wrong. `hash.test.ts`
 * pins this against the node implementation the script uses.
 *
 * Requires a secure context. localhost counts, so development works; a deployment
 * must be served over HTTPS or `crypto.subtle` is undefined.
 */
export async function sha256(data: BufferSource): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error(
      "hashing needs a secure context — serve this over HTTPS or localhost",
    );
  }

  const digest = await crypto.subtle.digest("SHA-256", data);

  return (
    "sha256:" +
    Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

/** Reads a file into memory and hashes it. Invoices are small; nothing streams. */
export async function sha256OfFile(file: File): Promise<string> {
  return sha256(await file.arrayBuffer());
}

/**
 * Hashes a file after checking it is plausibly an invoice.
 *
 * The bytes are read once and reused, so the check costs nothing beyond the read the
 * hash needed anyway.
 */
export async function sha256OfInvoice(file: File): Promise<string> {
  if (file.size === 0) {
    throw new Error("that file is empty");
  }

  if (file.size > MAX_BYTES) {
    throw new Error(
      `that file is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_BYTES)}`,
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  if (!looksLikePdf(bytes)) {
    throw new Error(
      "that does not look like a PDF — an invoice document must start with %PDF",
    );
  }

  return sha256(bytes);
}

/** Human-readable file size for the upload confirmation. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
