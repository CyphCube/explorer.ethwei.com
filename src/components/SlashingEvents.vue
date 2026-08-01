<script lang="ts" setup>
import { ref, onMounted } from 'vue';
import { useBlockchain, useFormatter } from '@/stores';
import { pubKeyToValcons } from '@/libs/address';
import type { Validator } from '@/types';

interface SlashEvent {
  height: string;
  time?: string;
  moniker: string;
  reason: string;
  burned: { denom: string; amount: string };
}

const chainStore = useBlockchain();
const format = useFormatter();

const events = ref<SlashEvent[]>([]);
const loading = ref(true);
const error = ref('');
// A slashed validator is usually jailed/unbonding by the time we look it up,
// so the store's default (bonded-only) validator list won't have it -- fetch
// all statuses locally instead of depending on what the parent page loaded.
const allValidators = ref<Validator[]>([]);

async function loadAllValidators() {
  const statuses = ['BOND_STATUS_BONDED', 'BOND_STATUS_UNBONDING', 'BOND_STATUS_UNBONDED'];
  const results = await Promise.all(
    statuses.map((s) =>
      chainStore.rpc
        ?.getStakingValidators(s, 300)
        .then((res: any) => res.validators as Validator[])
        .catch(() => [] as Validator[])
    )
  );
  allValidators.value = results.flat();
}

function monikerForValcons(valcons: string): string {
  const prefix = `${chainStore.current?.bech32Prefix || 'cosmos'}valcons`;
  const v = allValidators.value.find((val) => pubKeyToValcons(val.consensus_pubkey, prefix) === valcons);
  return v?.description?.moniker || `${valcons.slice(0, 14)}…`;
}

function reasonLabel(reason: string) {
  if (reason === 'double_sign') return 'Double Sign';
  if (reason === 'missing_signature') return 'Downtime';
  return reason;
}

// Slash events are BeginBlock events, not tx events, so /tx_search can't find
// them -- block_search over the indexed "slash.reason" attribute is the only
// way to locate historical occurrences without scanning every block.
async function fetchHeightsForReason(rpc: string, reason: string): Promise<string[]> {
  const query = encodeURIComponent(`"slash.reason='${reason}'"`);
  const url = `${rpc}/block_search?query=${query}&per_page=20&order_by=${encodeURIComponent('"desc"')}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.result?.blocks || []).map((b: any) => b.block.header.height as string);
}

// block_search only returns block metadata, not the events themselves --
// need a second call per height to read the slash event's attributes
// (burned_coins is the exact on-chain figure, not derived/estimated).
async function fetchEventAt(rpc: string, height: string): Promise<SlashEvent | null> {
  const res = await fetch(`${rpc}/block_results?height=${height}`);
  if (!res.ok) return null;
  const data = await res.json();
  const blockEvents = data.result?.finalize_block_events || [];
  const slashEvent = blockEvents.find((e: any) => e.type === 'slash');
  if (!slashEvent) return null;

  const attrs: Record<string, string> = {};
  for (const a of slashEvent.attributes) attrs[a.key] = a.value;
  if (!attrs.address || !attrs.burned_coins) return null;

  const block = await chainStore.rpc.getBaseBlockAt(height).catch(() => null);
  const time = (block as any)?.block?.header?.time;

  return {
    height,
    time,
    moniker: monikerForValcons(attrs.address),
    reason: attrs.reason || 'unknown',
    burned: { denom: chainStore.current?.assets?.[0]?.base || '', amount: attrs.burned_coins },
  };
}

async function loadEvents() {
  loading.value = true;
  error.value = '';
  try {
    const rpc = chainStore.current?.endpoints?.rpc?.at(0)?.address;
    if (!rpc) throw new Error('No RPC endpoint configured for this chain.');

    const [, downtimeHeights, doubleSignHeights] = await Promise.all([
      loadAllValidators(),
      fetchHeightsForReason(rpc, 'missing_signature'),
      fetchHeightsForReason(rpc, 'double_sign'),
    ]);

    const heights = Array.from(new Set([...downtimeHeights, ...doubleSignHeights]))
      .sort((a, b) => Number(b) - Number(a))
      .slice(0, 10);

    const results = await Promise.all(heights.map((h) => fetchEventAt(rpc, h)));
    events.value = results.filter((e): e is SlashEvent => e !== null);
  } catch (e: any) {
    error.value = e?.message || 'Failed to load slashing events.';
  } finally {
    loading.value = false;
  }
}

onMounted(loadEvents);
</script>

<template>
  <div class="bg-base-100 px-4 pt-3 pb-4 rounded shadow mb-4">
    <div class="text-lg font-semibold mb-2">Recent Slashing Events</div>

    <div v-if="loading" class="text-sm text-gray-400 py-4 text-center">Loading…</div>
    <div v-else-if="error" class="text-sm text-error py-4 text-center">{{ error }}</div>
    <div v-else-if="events.length === 0" class="text-sm text-gray-400 py-4 text-center">
      No slashing events recorded.
    </div>
    <div v-else class="overflow-x-auto">
      <table class="table w-full">
        <thead class="bg-base-200">
          <tr>
            <th scope="col" class="uppercase">Validator</th>
            <th scope="col" class="uppercase">Reason</th>
            <th scope="col" class="text-right uppercase">Burned</th>
            <th scope="col" class="text-right uppercase">Block</th>
            <th scope="col" class="text-right uppercase">Time</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in events" :key="e.height" class="hover:bg-gray-100 dark:hover:bg-[#384059]">
            <td>{{ e.moniker }}</td>
            <td>
              <span class="badge badge-sm text-white border-none" :class="e.reason === 'double_sign' ? 'badge-error' : 'badge-warning'">
                {{ reasonLabel(e.reason) }}
              </span>
            </td>
            <td class="text-right text-error">-{{ format.formatToken(e.burned) }}</td>
            <td class="text-right">
              <RouterLink :to="`/${chainStore.chainName}/block/${e.height}`" class="text-primary">{{ e.height }}</RouterLink>
            </td>
            <td class="text-right text-xs text-gray-400 whitespace-nowrap">{{ format.toDay(e.time, 'long') }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
