// apps/web/src/lib/hash.ts
//
// Hashing the invoice document in the browser, so it never leaves the machine.
//
// This is the privacy claim the whole design rests on: the funder verifies that the
// document they were shown is the one that was financed, without the document — or the
// commercial terms inside it — ever being uploaded or published.

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
      'hashing needs a secure context — serve this over HTTPS or localhost',
    );
  }

  const digest = await crypto.subtle.digest('SHA-256', data);

  return (
    'sha256:' +
    Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  );
}

/** Reads a file into memory and hashes it. Invoices are small; nothing streams. */
export async function sha256OfFile(file: File): Promise<string> {
  return sha256(await file.arrayBuffer());
}

/** Human-readable file size for the upload confirmation. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
