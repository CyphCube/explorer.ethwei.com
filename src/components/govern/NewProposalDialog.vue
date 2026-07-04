<script lang="ts" setup>
import { computed, ref } from 'vue';
import { useBlockchain, useBaseStore, useWalletStore } from '@/stores';
import { SigningStargateClient, defaultRegistryTypes } from '@cosmjs/stargate';
import { Registry } from '@cosmjs/proto-signing';
import { MsgSubmitProposal, MsgExecLegacyContent } from 'cosmjs-types/cosmos/gov/v1/tx';
import { MsgCommunityPoolSpend } from 'cosmjs-types/cosmos/distribution/v1beta1/tx';
import { MsgSoftwareUpgrade } from 'cosmjs-types/cosmos/upgrade/v1beta1/tx';
import { ParameterChangeProposal } from 'cosmjs-types/cosmos/params/v1beta1/params';
import type { Any } from 'cosmjs-types/google/protobuf/any';

const emit = defineEmits<{ (e: 'submitted'): void }>();

const chainStore = useBlockchain();
const baseStore = useBaseStore();
const walletStore = useWalletStore();

// Gov messages need more than the default 200000 gas (confirmed OOM on Ethwei).
const GAS_LIMIT = '400000';
const MIN_DEPOSIT_ETE = 100;

const show = ref(false);
const loading = ref(false);
const error = ref('');
const successHash = ref('');

const proposalType = ref<'text' | 'community_pool_spend' | 'software_upgrade' | 'parameter_change'>('text');
const title = ref('');
const summary = ref('');
const deposit = ref(String(MIN_DEPOSIT_ETE));

// community pool spend
const recipient = ref('');
const spendAmount = ref('');
// software upgrade
const upgradeName = ref('');
const upgradeHeight = ref('');
const upgradeInfo = ref('');
// parameter change (legacy)
const paramSubspace = ref('');
const paramKey = ref('');
const paramValue = ref('');

const asset = computed(() => chainStore.current?.assets?.[0]);
const symbol = computed(() => asset.value?.symbol || 'ETE');
const denom = computed(() => asset.value?.base || 'WEI');
const exponent = computed(() => {
  const du = asset.value?.denom_units?.find((x: any) => x.denom === (asset.value?.symbol || '').toLowerCase());
  return Number(du?.exponent ?? 6);
});

function reset() {
  error.value = '';
  successHash.value = '';
}

function open() {
  reset();
  show.value = true;
}
function close() {
  if (loading.value) return;
  show.value = false;
}

// Decimal display amount -> integer base-unit string, without float rounding.
function toBaseAmount(amountStr: string, exp: number): string {
  const clean = String(amountStr).trim();
  if (!clean || isNaN(Number(clean))) return '0';
  const [whole, frac = ''] = clean.split('.');
  const fracPadded = (frac + '0'.repeat(exp)).slice(0, exp);
  const combined = (whole || '0') + fracPadded;
  return combined.replace(/^0+/, '') || '0';
}

async function fetchGovAuthority(): Promise<string> {
  const rest = chainStore.current?.endpoints?.rest?.at(0)?.address;
  const res = await fetch(`${rest}/cosmos/auth/v1beta1/module_accounts/gov`);
  if (!res.ok) throw new Error(`Could not fetch gov module account (HTTP ${res.status}).`);
  const data = await res.json();
  const acc = data.account;
  const addr = acc?.base_account?.address || acc?.address || acc?.value?.address;
  if (!addr) throw new Error('Gov module authority address not found in API response.');
  return addr;
}

async function buildInnerMessages(): Promise<Any[]> {
  if (proposalType.value === 'text') return [];

  const authority = await fetchGovAuthority();

  if (proposalType.value === 'community_pool_spend') {
    if (!recipient.value.trim()) throw new Error('Recipient address is required.');
    const inner = MsgCommunityPoolSpend.fromPartial({
      authority,
      recipient: recipient.value.trim(),
      amount: [{ denom: denom.value, amount: toBaseAmount(spendAmount.value, exponent.value) }],
    });
    return [
      { typeUrl: '/cosmos.distribution.v1beta1.MsgCommunityPoolSpend', value: MsgCommunityPoolSpend.encode(inner).finish() },
    ];
  }

  if (proposalType.value === 'software_upgrade') {
    if (!upgradeName.value.trim() || !upgradeHeight.value.trim()) throw new Error('Upgrade name and height are required.');
    const inner = MsgSoftwareUpgrade.fromPartial({
      authority,
      plan: {
        name: upgradeName.value.trim(),
        height: BigInt(upgradeHeight.value.trim() || '0'),
        info: upgradeInfo.value.trim(),
        time: undefined,
        upgradedClientState: undefined,
      },
    });
    return [{ typeUrl: '/cosmos.upgrade.v1beta1.MsgSoftwareUpgrade', value: MsgSoftwareUpgrade.encode(inner).finish() }];
  }

  // parameter_change (legacy content via MsgExecLegacyContent)
  if (!paramSubspace.value.trim() || !paramKey.value.trim()) throw new Error('Subspace and key are required.');
  const content = {
    typeUrl: '/cosmos.params.v1beta1.ParameterChangeProposal',
    value: ParameterChangeProposal.encode(
      ParameterChangeProposal.fromPartial({
        title: title.value,
        description: summary.value,
        changes: [{ subspace: paramSubspace.value.trim(), key: paramKey.value.trim(), value: paramValue.value.trim() }],
      })
    ).finish(),
  };
  const inner = MsgExecLegacyContent.fromPartial({ content, authority });
  return [{ typeUrl: '/cosmos.gov.v1.MsgExecLegacyContent', value: MsgExecLegacyContent.encode(inner).finish() }];
}

async function submit() {
  reset();
  // client-side validation
  if (!title.value.trim()) return void (error.value = 'Title is required.');
  if (!summary.value.trim()) return void (error.value = 'Summary is required.');
  if (Number(deposit.value) < MIN_DEPOSIT_ETE)
    return void (error.value = `Initial deposit must be at least ${MIN_DEPOSIT_ETE} ${symbol.value}.`);

  const keplr = (window as any).keplr;
  if (!keplr) return void (error.value = 'Keplr extension not detected. Install Keplr and reload this page.');

  const chainId = baseStore.currentChainId;
  const rpc = chainStore.current?.endpoints?.rpc?.at(0)?.address;
  if (!rpc) return void (error.value = 'No RPC endpoint configured for this chain.');

  loading.value = true;
  try {
    await keplr.enable(chainId);
    const signer = keplr.getOfflineSigner(chainId);
    const accounts = await signer.getAccounts();
    const proposer = accounts[0]?.address;
    if (!proposer) throw new Error('No account found in Keplr.');

    const inner = await buildInnerMessages();

    // defaultRegistryTypes / Registry / SigningStargateClient come from different
    // (dual-versioned) @cosmjs/proto-signing copies, so their generated-type
    // signatures clash at compile time only. The encoders are identical at
    // runtime, hence the `as any` casts at these boundaries.
    const registry = new Registry(defaultRegistryTypes as any);
    registry.register('/cosmos.gov.v1.MsgSubmitProposal', MsgSubmitProposal as any);

    const client = await SigningStargateClient.connectWithSigner(rpc, signer, { registry: registry as any });

    const msg = {
      typeUrl: '/cosmos.gov.v1.MsgSubmitProposal',
      value: MsgSubmitProposal.fromPartial({
        messages: inner,
        initialDeposit: [{ denom: denom.value, amount: toBaseAmount(deposit.value, exponent.value) }],
        proposer,
        metadata: '',
        title: title.value.trim(),
        summary: summary.value.trim(),
      }),
    };

    const fee = { amount: [{ denom: denom.value, amount: '20000' }], gas: GAS_LIMIT };
    const res = await client.signAndBroadcast(proposer, [msg], fee, '');

    if (res.code === 0) {
      successHash.value = res.transactionHash;
      emit('submitted');
    } else {
      error.value = `Tx failed (code ${res.code}): ${res.rawLog || 'unknown error'}`;
    }
  } catch (e: any) {
    error.value = e?.message || String(e);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="inline-block">
    <button class="btn btn-primary btn-sm text-white" @click="open">+ New Proposal</button>

    <div v-if="show" class="modal !pointer-events-auto !opacity-100 !visible" @click.self="close">
      <div class="modal-box max-w-xl">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-bold">New Proposal</h3>
          <button class="btn btn-sm btn-circle btn-ghost" @click="close">✕</button>
        </div>

        <!-- Type -->
        <label class="block text-sm text-gray-500 mb-1">Type</label>
        <select v-model="proposalType" class="select select-bordered w-full mb-3" :disabled="loading">
          <option value="text">Text</option>
          <option value="community_pool_spend">Community Pool Spend</option>
          <option value="software_upgrade">Software Upgrade</option>
          <option value="parameter_change">Parameter Change (legacy)</option>
        </select>

        <!-- Common -->
        <label class="block text-sm text-gray-500 mb-1">Title</label>
        <input v-model="title" class="input input-bordered w-full mb-3" placeholder="Proposal title" :disabled="loading" />

        <label class="block text-sm text-gray-500 mb-1">Summary</label>
        <textarea
          v-model="summary"
          rows="3"
          class="textarea textarea-bordered w-full mb-3"
          placeholder="What does this proposal do?"
          :disabled="loading"
        ></textarea>

        <!-- Community Pool Spend -->
        <template v-if="proposalType === 'community_pool_spend'">
          <label class="block text-sm text-gray-500 mb-1">Recipient</label>
          <input v-model="recipient" class="input input-bordered w-full mb-3" placeholder="ete1..." :disabled="loading" />
          <label class="block text-sm text-gray-500 mb-1">Amount ({{ symbol }})</label>
          <input v-model="spendAmount" class="input input-bordered w-full mb-3" placeholder="0" :disabled="loading" />
        </template>

        <!-- Software Upgrade -->
        <template v-if="proposalType === 'software_upgrade'">
          <label class="block text-sm text-gray-500 mb-1">Upgrade name</label>
          <input v-model="upgradeName" class="input input-bordered w-full mb-3" placeholder="v2" :disabled="loading" />
          <label class="block text-sm text-gray-500 mb-1">Upgrade height</label>
          <input v-model="upgradeHeight" class="input input-bordered w-full mb-3" placeholder="1000000" :disabled="loading" />
          <label class="block text-sm text-gray-500 mb-1">Info (optional)</label>
          <input v-model="upgradeInfo" class="input input-bordered w-full mb-3" placeholder="upgrade info / json" :disabled="loading" />
        </template>

        <!-- Parameter Change -->
        <template v-if="proposalType === 'parameter_change'">
          <label class="block text-sm text-gray-500 mb-1">Subspace</label>
          <input v-model="paramSubspace" class="input input-bordered w-full mb-3" placeholder="staking" :disabled="loading" />
          <label class="block text-sm text-gray-500 mb-1">Key</label>
          <input v-model="paramKey" class="input input-bordered w-full mb-3" placeholder="MaxValidators" :disabled="loading" />
          <label class="block text-sm text-gray-500 mb-1">Value</label>
          <input v-model="paramValue" class="input input-bordered w-full mb-3" placeholder='100' :disabled="loading" />
        </template>

        <!-- Deposit -->
        <label class="block text-sm text-gray-500 mb-1">Initial deposit ({{ symbol }})</label>
        <input v-model="deposit" class="input input-bordered w-full mb-1" :disabled="loading" />
        <p class="text-xs text-gray-400 mb-3">Minimum {{ MIN_DEPOSIT_ETE }} {{ symbol }} · gas limit {{ GAS_LIMIT }}</p>

        <div v-if="error" class="alert alert-error text-sm mb-3 break-words">{{ error }}</div>
        <div v-if="successHash" class="alert alert-success text-sm mb-3 break-words">
          ✓ Proposal submitted. Tx:
          <RouterLink :to="`/${chainStore.chainName}/tx/${successHash}`" class="underline" @click="close">
            {{ successHash.slice(0, 12) }}…
          </RouterLink>
        </div>

        <div class="flex justify-end gap-2 mt-2">
          <button class="btn btn-sm" @click="close" :disabled="loading">Close</button>
          <button v-if="!successHash" class="btn btn-sm btn-primary text-white" @click="submit" :disabled="loading">
            <span v-if="loading" class="loading loading-spinner loading-xs mr-1"></span>
            {{ loading ? 'Submitting…' : 'Submit & Sign' }}
          </button>
        </div>

        <p v-if="!walletStore.currentAddress" class="text-xs text-gray-400 mt-3">
          Signing will prompt Keplr to connect.
        </p>
      </div>
    </div>
  </div>
</template>
<!-- emit declared at top of script -->

