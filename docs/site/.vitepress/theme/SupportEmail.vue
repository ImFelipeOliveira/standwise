<script setup lang="ts">
import { useData } from 'vitepress';

const { theme } = useData<{ supportEmail: string }>();
</script>

<template>
  <a :href="`mailto:${theme.supportEmail}`">{{ theme.supportEmail }}</a>
</template>
