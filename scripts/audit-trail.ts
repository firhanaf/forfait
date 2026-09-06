// scripts/audit-trail.ts
//
// Forfait writes the receivable lifecycle to a Hedera Consensus Service topic.
// The platform owns this topic — freelancers and funders never write to it, which is
// why it runs here with the operator key rather than in the browser.
//
//   npx tsx scripts/audit-trail.ts create
//   npx tsx scripts/audit-trail.ts emit  INV-2026-0042 SUBMITTED ./invoice.pdf
//   npx tsx scripts/audit-trail.ts read  INV-2026-0042
//
// The invoice document never touches the ledger. Only its SHA-256 hash is published,
// so a funder can verify the document they were shown is the one that was financed,
// without the commercial terms becoming public.

import {
  Client, PrivateKey, AccountId, TopicId,
  TopicCreateTransaction, TopicMessageSubmitTransaction,
} from '@hiero-ledger/sdk';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import 'dotenv/config';

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`\n[.env] ${k} is not set\n`);
  return v;
};

const operatorId = AccountId.fromString(env('HEDERA_ACCOUNT_ID'));
const operatorKey = PrivateKey.fromStringECDSA(env('HEDERA_PRIVATE_KEY'));
const client = Client.forTestnet().setOperator(operatorId, operatorKey);

const MIRROR = process.env.MIRROR_NODE_URL ?? 'https://testnet.mirrornode.hedera.com/api/v1';

/** Lifecycle of a receivable, in the order it can legally occur. */
export const STATUSES = ['SUBMITTED', 'VERIFIED', 'FUNDED', 'PAID', 'SETTLED'] as const;
export type Status = (typeof STATUSES)[number];

/**
 * One HCS message. Deliberately small — a few hundred bytes, well under the 1024-byte
 * chunk limit, so a message is never split across sequence numbers.
 */
interface AuditEvent {
  v: 1;
  invoice: string;      // issuer's own reference, e.g. INV-2026-0042
  security: string;     // ATS security id, e.g. 0.0.10373584
  status: Status;
  docHash: string;      // sha256 of the invoice document
  actor: string;        // account that caused the transition
  at: string;           // ISO 8601
}

// ─────────────────────────────────────────────────────────────
// create — run once, then put the topic id in .env
// ─────────────────────────────────────────────────────────────
async function create() {
  const receipt = await (
    await new TopicCreateTransaction()
      .setTopicMemo('Forfait — receivable lifecycle audit trail')
      .setAdminKey(operatorKey.publicKey)   // without this the topic can never be changed
      .setSubmitKey(operatorKey.publicKey)  // without this anyone could forge entries
      .execute(client)
  ).getReceipt(client);

  const topicId = receipt.topicId!.toString();
  console.log(`\nTopic created: ${topicId}`);
  console.log(`Add to .env:   HCS_TOPIC_ID=${topicId}`);
  console.log(`HashScan:      https://hashscan.io/testnet/topic/${topicId}\n`);
}

// ─────────────────────────────────────────────────────────────
// emit — record one lifecycle transition
// ─────────────────────────────────────────────────────────────
async function emit(invoice: string, status: Status, docPath: string) {
  if (!STATUSES.includes(status)) {
    throw new Error(`status must be one of: ${STATUSES.join(', ')}`);
  }

  const doc = readFileSync(docPath);
  const docHash = 'sha256:' + createHash('sha256').update(doc).digest('hex');

  const event: AuditEvent = {
    v: 1,
    invoice,
    security: env('SECURITY_ID'),
    status,
    docHash,
    actor: operatorId.toString(),
    at: new Date().toISOString(),
  };

  const body = JSON.stringify(event);
  if (Buffer.byteLength(body) > 1024) {
    throw new Error('message exceeds 1024 bytes and would be chunked');
  }

  const receipt = await (
    await new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(env('HCS_TOPIC_ID')))
      .setMessage(body)
      .execute(client)
  ).getReceipt(client);

  console.log(`seq=${receipt.topicSequenceNumber}  ${status}  ${invoice}`);
  console.log(`  ${docHash}`);
}

// ─────────────────────────────────────────────────────────────
// read — replay the trail for one invoice, straight from the mirror node
// ─────────────────────────────────────────────────────────────
async function read(invoice?: string) {
  const topicId = env('HCS_TOPIC_ID');
  const res = await fetch(`${MIRROR}/topics/${topicId}/messages?order=asc&limit=100`);
  const data: any = await res.json();

  const events: Array<AuditEvent & { seq: number; consensus: string }> = data.messages
    .map((m: any) => ({
      ...JSON.parse(Buffer.from(m.message, 'base64').toString()),
      seq: m.sequence_number,
      consensus: m.consensus_timestamp,
    }))
    .filter((e: AuditEvent) => !invoice || e.invoice === invoice);

  if (!events.length) {
    console.log('no events');
    return;
  }

  console.log(`\n${invoice ?? 'all invoices'} — ${events.length} events\n`);
  for (const e of events) {
    const when = new Date(Number(e.consensus.split('.')[0]) * 1000).toISOString();
    console.log(`  #${String(e.seq).padStart(3)}  ${e.status.padEnd(10)} ${when}`);
    console.log(`        ${e.docHash}`);
  }

  // The hash must not change once an invoice is funded — if it does, the document
  // shown to the funder is not the document that was financed.
  const hashes = new Set(events.map((e) => e.docHash));
  console.log(
    hashes.size === 1
      ? '\n  document hash consistent across the trail\n'
      : `\n  WARNING: ${hashes.size} different document hashes in this trail\n`
  );
}

// ─────────────────────────────────────────────────────────────
const [cmd, ...args] = process.argv.slice(2);
const run = async () => {
  switch (cmd) {
    case 'create': return create();
    case 'emit':   return emit(args[0], args[1] as Status, args[2]);
    case 'read':   return read(args[0]);
    default:
      console.log('usage: create | emit <invoice> <status> <docPath> | read [invoice]');
  }
};

run().then(() => client.close()).catch((e) => {
  console.error(e);
  client.close();
  process.exit(1);
});