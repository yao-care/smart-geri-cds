<script lang="ts">
import { SelfCheckStore } from '$lib/stores/self-check.svelte';
import type { SelfCheckScale } from '$lib/self-check/self-check';
import SelfCheckIntro from './SelfCheckIntro.svelte';
import SelfCheckQuestionnaire from './SelfCheckQuestionnaire.svelte';
import SelfCheckResult from './SelfCheckResult.svelte';

interface Props { scales: SelfCheckScale[]; }
const { scales }: Props = $props();

const store = new SelfCheckStore(scales);
</script>

{#if store.step === 'intro'}
  <SelfCheckIntro onStart={() => store.start()} />
{:else if store.step === 'screening'}
  <SelfCheckQuestionnaire {store} />
{:else}
  <SelfCheckResult {store} />
{/if}
