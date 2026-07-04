// Building blocks for gov-v1 MsgUpdateParams proposals.
//
// The REST API returns module params as snake_case JSON with durations like
// "86400s" and legacy Dec fields as decimal strings. The proto codecs want
// camelCase, Duration objects, and (for slashing) Dec-as-ASCII-bytes, so
// normalizeParams() converts between the two representations.
//
// gov's own Params codec in cosmjs-types 0.9 predates SDK 0.50 and is missing
// 6 fields (expedited_*, proposal_cancel_*, min_deposit_ratio); encoding with
// it would silently zero them on-chain. encodeGovMsgUpdateParams() hand-encodes
// the full SDK 0.50 field set instead.

import { BinaryWriter } from 'cosmjs-types/binary';
import { Coin } from 'cosmjs-types/cosmos/base/v1beta1/coin';
import { Duration } from 'cosmjs-types/google/protobuf/duration';
import { MsgUpdateParams as StakingMsgUpdateParams } from 'cosmjs-types/cosmos/staking/v1beta1/tx';
import { MsgUpdateParams as DistributionMsgUpdateParams } from 'cosmjs-types/cosmos/distribution/v1beta1/tx';
import { MsgUpdateParams as SlashingMsgUpdateParams } from 'cosmjs-types/cosmos/slashing/v1beta1/tx';

// REST JSON keys holding a google.protobuf.Duration rendered as "<n>s"
const DURATION_KEYS = new Set([
  'unbonding_time',
  'voting_period',
  'max_deposit_period',
  'expedited_voting_period',
  'downtime_jail_duration',
]);

// Legacy Dec fields (gogoproto customtype LegacyDec) marshal on the wire as
// the ASCII text of value*10^18 — NOT the human "0.500000000000000000" form
// the REST API displays. Passing the display string through unchanged makes
// the chain fail with `cannot unmarshal ... into a *big.Int: tx parse error`.
// gov v1's dec params (quorum etc.) are plain proto strings and stay human-form.

// proto `bytes` Dec fields (slashing)
const DEC_BYTES_KEYS = new Set(['min_signed_per_window', 'slash_fraction_double_sign', 'slash_fraction_downtime']);
// proto `string` Dec fields with customtype (staking, distribution)
const DEC_STRING_KEYS = new Set([
  'min_commission_rate',
  'community_tax',
  'base_proposer_reward',
  'bonus_proposer_reward',
]);

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function parseDurationString(s: string): { seconds: string; nanos: number } {
  const m = /^(\d+)(?:\.(\d+))?s$/.exec(s.trim());
  if (!m) throw new Error(`"${s}" is not a duration (expected e.g. "86400s").`);
  const nanos = m[2] ? Number((m[2] + '000000000').slice(0, 9)) : 0;
  return { seconds: m[1], nanos };
}

// "0.500000000000000000" -> "500000000000000000" (LegacyDec.Marshal text)
export function decToIntString(dec: string): string {
  if (!/^\d+(\.\d+)?$/.test(dec.trim())) throw new Error(`"${dec}" is not a decimal number.`);
  const [whole, frac = ''] = dec.trim().split('.');
  const fracPadded = (frac + '0'.repeat(18)).slice(0, 18);
  return ((whole || '0') + fracPadded).replace(/^0+/, '') || '0';
}

export function decToBytes(dec: string): Uint8Array {
  const intStr = decToIntString(dec);
  const out = new Uint8Array(intStr.length);
  for (let i = 0; i < intStr.length; i++) out[i] = intStr.charCodeAt(i);
  return out;
}

/** REST param JSON (snake_case) -> object accepted by the codecs' fromPartial. */
export function normalizeParams(obj: any): any {
  if (Array.isArray(obj)) return obj.map((x) => normalizeParams(x));
  if (obj === null || typeof obj !== 'object') return obj;
  const out: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (DURATION_KEYS.has(key) && typeof value === 'string') {
      out[snakeToCamel(key)] = parseDurationString(value);
    } else if (DEC_BYTES_KEYS.has(key) && typeof value === 'string') {
      out[snakeToCamel(key)] = decToBytes(value);
    } else if (DEC_STRING_KEYS.has(key) && typeof value === 'string') {
      out[snakeToCamel(key)] = decToIntString(value);
    } else {
      out[snakeToCamel(key)] = normalizeParams(value);
    }
  }
  return out;
}

// gov v1 Params (SDK 0.50 field set) hand encoder; p is normalizeParams output.
function encodeGovParams(p: any, w: BinaryWriter): BinaryWriter {
  for (const c of p.minDeposit ?? []) Coin.encode(Coin.fromPartial(c), w.uint32(10).fork()).ldelim();
  if (p.maxDepositPeriod) Duration.encode(Duration.fromPartial(p.maxDepositPeriod), w.uint32(18).fork()).ldelim();
  if (p.votingPeriod) Duration.encode(Duration.fromPartial(p.votingPeriod), w.uint32(26).fork()).ldelim();
  if (p.quorum) w.uint32(34).string(p.quorum);
  if (p.threshold) w.uint32(42).string(p.threshold);
  if (p.vetoThreshold) w.uint32(50).string(p.vetoThreshold);
  if (p.minInitialDepositRatio) w.uint32(58).string(p.minInitialDepositRatio);
  if (p.proposalCancelRatio) w.uint32(66).string(p.proposalCancelRatio);
  if (p.proposalCancelDest) w.uint32(74).string(p.proposalCancelDest);
  if (p.expeditedVotingPeriod) Duration.encode(Duration.fromPartial(p.expeditedVotingPeriod), w.uint32(82).fork()).ldelim();
  if (p.expeditedThreshold) w.uint32(90).string(p.expeditedThreshold);
  for (const c of p.expeditedMinDeposit ?? []) Coin.encode(Coin.fromPartial(c), w.uint32(98).fork()).ldelim();
  if (p.burnVoteQuorum) w.uint32(104).bool(true);
  if (p.burnProposalDepositPrevote) w.uint32(112).bool(true);
  if (p.burnVoteVeto) w.uint32(120).bool(true);
  if (p.minDepositRatio) w.uint32(130).string(p.minDepositRatio);
  return w;
}

export function encodeGovMsgUpdateParams(authority: string, normalizedParams: any): Uint8Array {
  const w = new BinaryWriter();
  w.uint32(10).string(authority); // field 1: authority
  encodeGovParams(normalizedParams, w.uint32(18).fork()).ldelim(); // field 2: params
  return w.finish();
}

export interface ParamModule {
  label: string;
  paramsUrl: string; // relative to the REST endpoint
  typeUrl: string;
  encode: (authority: string, normalizedParams: any) => Uint8Array;
}

export const PARAM_MODULES: Record<string, ParamModule> = {
  staking: {
    label: 'Staking',
    paramsUrl: '/cosmos/staking/v1beta1/params',
    typeUrl: '/cosmos.staking.v1beta1.MsgUpdateParams',
    encode: (authority, params) =>
      StakingMsgUpdateParams.encode(StakingMsgUpdateParams.fromPartial({ authority, params })).finish(),
  },
  gov: {
    label: 'Governance',
    paramsUrl: '/cosmos/gov/v1/params/voting',
    typeUrl: '/cosmos.gov.v1.MsgUpdateParams',
    encode: encodeGovMsgUpdateParams,
  },
  distribution: {
    label: 'Distribution',
    paramsUrl: '/cosmos/distribution/v1beta1/params',
    typeUrl: '/cosmos.distribution.v1beta1.MsgUpdateParams',
    encode: (authority, params) =>
      DistributionMsgUpdateParams.encode(DistributionMsgUpdateParams.fromPartial({ authority, params })).finish(),
  },
  slashing: {
    label: 'Slashing',
    paramsUrl: '/cosmos/slashing/v1beta1/params',
    typeUrl: '/cosmos.slashing.v1beta1.MsgUpdateParams',
    encode: (authority, params) =>
      SlashingMsgUpdateParams.encode(SlashingMsgUpdateParams.fromPartial({ authority, params })).finish(),
  },
};
