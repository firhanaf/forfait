// scripts/schedule-settlement.ts
//
// Hands settlement to the network.
//
// At maturity the receivable is redeemed: the holder's unit is burned and the position
// closes. Nothing has to be running for that to happen — no cron, no keeper bot, no
// server staying awake for sixty days. The transaction is signed once, at issuance, and
// the network executes it when the maturity date arrives.
//
//   npx tsx scripts/schedule-settlement.ts create <securityId> <holderEvmAddress> <maturityEpochSeconds>
//   npx tsx scripts/schedule-settlement.ts info   <scheduleId>
//
// The call data is not built from an ABI. ATS ships no JSON ABIs, so the selector below
// was read off a real redemption recorded on the mirror node rather than guessed from a
// function name — see FRICTION.md #4.

import {
  AccountId,
  Client,
  ContractExecuteTransaction,
  ContractId,
  Hbar,
  PrivateKey,
  ScheduleCreateTransaction,
  ScheduleId,
  ScheduleInfoQuery,
  Timestamp,
} from '@hiero-ledger/sdk';
import 'dotenv/config';

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`\n[.env] ${k} is not set\n`);
  return v;
};

const operatorId = AccountId.fromString(env('HEDERA_ACCOUNT_ID'));
const operatorKey = PrivateKey.fromStringECDSA(env('HEDERA_PRIVATE_KEY'));
const client = Client.forTestnet().setOperator(operatorId, operatorKey);

/**
 * Selector for full redemption at maturity on the ATS diamond, taking the holder's
 * address. Read off a successful redemption recorded on the mirror node — the SDK
 * produced this call, the network accepted it, and it is copied here verbatim rather
 * than reconstructed from a function name nobody can look up.
 */
const REDEEM_SELECTOR = 'd0db5fb2';

/** Measured: the successful redemption used 184,228. The reverted probe used 78,547. */
const GAS = 400_000;

/** 62 days, from SchedulingConfig in hedera-services. */
const MAX_SCHEDULE_MS = 5_356_800_000;

/** Placed after maturity, not on it. A schedule firing a second early is rejected. */
const BUFFER_SECONDS = 120;

/** ABI encoding for a single address: 20 bytes, left-padded to 32. */
function encodeRedeem(holderEvmAddress: string): Uint8Array {
  const address = holderEvmAddress.replace(/^0x/, '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(address)) {
    throw new Error(`not a 20-byte EVM address: ${holderEvmAddress}`);
  }
  return Buffer.from(REDEEM_SELECTOR + address.padStart(64, '0'), 'hex');
}

// ─────────────────────────────────────────────────────────────

async function create(securityId: string, holder: string, maturityEpochSeconds: number) {
  if (!Number.isFinite(maturityEpochSeconds) || maturityEpochSeconds > 1e11) {
    throw new Error(
      `maturity must be epoch seconds, not milliseconds — got ${maturityEpochSeconds}`,
    );
  }

  const expiry = new Date((maturityEpochSeconds + BUFFER_SECONDS) * 1000);
  const msAway = expiry.getTime() - Date.now();

  if (msAway <= 0) {
    throw new Error('maturity has already passed — a schedule cannot expire in the past');
  }
  if (msAway > MAX_SCHEDULE_MS) {
    throw new Error('expiry exceeds the 62-day scheduling ceiling');
  }

  const callData = encodeRedeem(holder);

  const settlement = new ContractExecuteTransaction()
    .setContractId(ContractId.fromString(securityId))
    .setGas(GAS)
    // The whole call, selector included — not the arguments alone.
    .setFunctionParameters(callData);

  const receipt = await (
    await new ScheduleCreateTransaction()
      .setScheduledTransaction(settlement)
      .setScheduleMemo(`Forfait settlement ${securityId}`)
      .setExpirationTime(Timestamp.fromDate(expiry))
      // Without this the transaction fires as soon as the required signatures are in —
      // which is immediately, since the operator signs here. This is what defers it.
      .setWaitForExpiry(true)
      // Keeps the schedule deletable. A disputed receivable must not settle on time,
      // and without an admin key nothing could stop it.
      .setAdminKey(operatorKey.publicKey)
      .setPayerAccountId(operatorId)
      .setMaxTransactionFee(new Hbar(5))
      .execute(client)
  ).getReceipt(client);

  const scheduleId = receipt.scheduleId!.toString();

  console.log(`\nSchedule created: ${scheduleId}`);
  console.log(
    `Executes at:      ${expiry.toISOString()}  (in ~${Math.round(msAway / 60_000)} min)`,
  );
  console.log(`Call data:        0x${Buffer.from(callData).toString('hex')}`);
  console.log(`HashScan:         https://hashscan.io/testnet/schedule/${scheduleId}\n`);
  console.log('Nothing needs to stay running. The network executes it at expiry.\n');
}

async function info(scheduleId: string) {
  const result = await new ScheduleInfoQuery()
    .setScheduleId(ScheduleId.fromString(scheduleId))
    .execute(client);

  console.log(`\nSchedule:    ${scheduleId}`);
  console.log(`Memo:        ${result.scheduleMemo}`);
  console.log(`Expires:     ${result.expirationTime?.toDate().toISOString()}`);
  console.log(`Executed:    ${result.executed?.toDate().toISOString() ?? 'not yet'}`);
  console.log(`Deleted:     ${result.deleted?.toDate().toISOString() ?? 'no'}`);
  console.log(`Wait expiry: ${result.waitForExpiry}\n`);
}

// ─────────────────────────────────────────────────────────────

const [cmd, ...args] = process.argv.slice(2);

const USAGE =
  'usage: create <securityId> <holderEvmAddress> <maturityEpochSeconds> | info <scheduleId>';

const run = async () => {
  switch (cmd) {
    case 'create':
      if (args.length < 3) throw new Error(USAGE);
      return create(args[0], args[1], Number(args[2]));
    case 'info':
      if (!args[0]) throw new Error(USAGE);
      return info(args[0]);
    default:
      console.log(USAGE);
  }
};

run()
  .then(() => client.close())
  .catch((e) => {
    console.error(e);
    client.close();
    process.exit(1);
  });
