<script lang="ts">
  interface HealthResponse {
    status: string;
    database: string;
    invoices: {
      count: number;
      total: { amount: string; formatted: string };
      financialDateSpan: { first: string | null; last: string | null };
    };
  }

  let health = $state<HealthResponse | null>(null);
  let error = $state<string | null>(null);

  async function checkHealth() {
    health = null;
    error = null;
    try {
      const res = await fetch('/api/health');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      health = await res.json();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
</script>

<main>
  <h1>Calyx Report Generator</h1>
  <p>Read-only reporting over the legacy Calyx POS database.</p>

  <button onclick={checkHealth}>Run health check</button>

  {#if error}
    <p class="error">Health check failed: {error}</p>
  {:else if health}
    <dl>
      <dt>Database</dt>
      <dd>{health.database}</dd>
      <dt>Invoices</dt>
      <dd>{health.invoices.count}</dd>
      <dt>Total</dt>
      <dd>{health.invoices.total.formatted}</dd>
      <dt>Financial-date span</dt>
      <dd>{health.invoices.financialDateSpan.first} → {health.invoices.financialDateSpan.last}</dd>
    </dl>
  {/if}
</main>

<style>
  main {
    font-family: system-ui, sans-serif;
    max-width: 40rem;
    margin: 2rem auto;
    padding: 0 1rem;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.25rem 1rem;
  }
  dt {
    font-weight: 600;
  }
  .error {
    color: #b00020;
  }
</style>
