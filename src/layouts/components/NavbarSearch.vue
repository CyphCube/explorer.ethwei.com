<script lang="ts" setup>
import { Icon } from '@iconify/vue';
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useBlockchain } from '@/stores';

const vueRouters = useRouter();
const blockStore = useBlockchain();
let searchModalShow = ref(false);
let searchQuery = ref('');
let errorMessage = ref('');
let inputError = ref(false);

function closeSearchModal() {
  searchModalShow.value = false;
  searchQuery.value = '';
  errorMessage.value = '';
}
function openSearchModal() {
  searchModalShow.value = true;
}
function preventClick(event: any) {
  event.preventDefault();
  event.stopPropagation();
}

function navigate(key: string) {
  const height = /^\d+$/;
  const txhash = /^[A-Z\d]{64}$/;
  const addr = /^[a-z\d]+1[a-z\d]{38,58}$/;

  // default to testnet when on the landing page
  const current = blockStore?.current?.chainName || 'testnet';

  if (height.test(key)) {
    vueRouters.push({ path: `/${current}/block/${key}` });
    return true;
  } else if (txhash.test(key)) {
    vueRouters.push({ path: `/${current}/tx/${key}` });
    return true;
  } else if (addr.test(key)) {
    vueRouters.push({ path: `/${current}/account/${key}` });
    return true;
  }
  return false;
}

function confirm() {
  errorMessage.value = '';
  inputError.value = false;
  const key = searchQuery.value.trim();
  if (!key) {
    errorMessage.value = 'Please enter a value!';
    inputError.value = true;
    return;
  }
  if (navigate(key)) {
    searchQuery.value = '';
    setTimeout(closeSearchModal, 800);
  } else {
    errorMessage.value = 'Not recognized — enter a block height, tx hash, or address.';
    inputError.value = true;
    setTimeout(() => { inputError.value = false; }, 1500);
  }
}
</script>

<template>
  <div>
    <!-- Desktop: inline search bar in header -->
    <div class="hidden md:!flex items-center rounded-lg bg-gray-100 dark:bg-[#252d45] border border-gray-200 dark:border-gray-600 h-9 px-3 w-60 lg:!w-80 mr-1"
      :class="{ 'border-error': inputError }">
      <Icon icon="mdi:magnify" class="text-lg text-gray-400 flex-shrink-0 mr-2" />
      <input
        v-model="searchQuery"
        placeholder="Height / Tx / Address"
        class="bg-transparent outline-none text-sm flex-1 min-w-0 placeholder-gray-400"
        @keyup.enter="confirm"
        @keyup.esc="searchQuery = ''"
      />
    </div>

    <!-- Mobile: icon that opens modal -->
    <button class="btn btn-ghost btn-circle btn-sm mx-1 md:!hidden" @click="openSearchModal">
      <Icon icon="mdi:magnify" class="text-2xl text-gray-500 dark:text-gray-400" />
    </button>

    <!-- Modal (mobile) -->
    <div
      v-if="searchModalShow"
      class="cursor-pointer modal !pointer-events-auto !opacity-100 !visible"
      @click="closeSearchModal"
    >
      <div class="relative modal-box cursor-default" @click="(event) => preventClick(event)">
        <div class="flex items-center justify-between">
          <div class="text-lg font-bold flex flex-col md:!flex-row justify-between items-baseline">
            <span class="mr-2">Search</span>
            <span class="capitalize text-sm md:!text-base">Height / Transaction / Account Address</span>
          </div>
          <label class="cursor-pointer" @click="closeSearchModal">
            <Icon icon="zondicons:close-outline" class="text-2xl text-gray-500 dark:text-gray-400" />
          </label>
        </div>
        <div class="mt-4">
          <input
            class="input flex-1 w-full !input-bordered"
            v-model="searchQuery"
            placeholder="Height / Transaction / Account Address"
            @keyup.enter="confirm"
          />
          <div class="mt-2 text-right text-sm text-error" v-show="errorMessage">
            {{ errorMessage }}
          </div>
        </div>
        <div class="mt-6">
          <button class="w-full btn btn-primary" @click="confirm">Confirm</button>
        </div>
      </div>
    </div>
  </div>
</template>
