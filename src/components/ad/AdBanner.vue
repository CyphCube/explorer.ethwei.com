<template>
  <!-- Ads removed for Ethwei -->
</template>

<script setup lang="ts">
// No-op stub. Replaces the Slise ad banner so no ads render and no
// third-party ad script (v1.slise.xyz) is loaded. It accepts the same props
// the call sites pass so nothing falls through, and renders nothing.
defineProps({
  slot: { type: String, default: '' },
  publisherId: { type: String, default: '' },
  format: { type: String, default: '' },
  width: { type: String, default: '' },
  height: { type: String, default: '' },
  id: { type: String, default: '' },
  unit: { type: String, default: '' },
});
</script>
