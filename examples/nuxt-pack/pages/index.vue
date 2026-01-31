<template>
  <div class="container">
    <div class="card">
      <h1>🚀 Nuxt Pack Example</h1>
      <p class="subtitle">A Nuxt app built as a Stark Orchestrator pack</p>
      
      <div class="pack-info">
        <div class="pack-label">Pack Name:</div>
        <div class="pack-name">{{ packName }}</div>
      </div>

      <div class="status-section">
        <h2>Node Status</h2>
        <div class="status-item">
          <span class="status-indicator" :class="connectionState"></span>
          <span class="status-text">{{ statusText }}</span>
        </div>
      </div>

      <div class="actions">
        <button @click="incrementCounter" class="btn">
          Clicked: {{ counter }} times
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

// Pack metadata - this would come from the orchestrator context
const packName = ref('nuxt-pack-example');
const connectionState = ref<'disconnected' | 'connecting' | 'connected' | 'registered'>('disconnected');
const counter = ref(0);

const statusText = computed(() => {
  switch (connectionState.value) {
    case 'disconnected': return 'Disconnected from orchestrator';
    case 'connecting': return 'Connecting to orchestrator...';
    case 'connected': return 'Connected, awaiting registration';
    case 'registered': return 'Registered and ready';
    default: return 'Unknown status';
  }
});

function incrementCounter() {
  counter.value++;
}

// Simulate connection state changes (in real usage, this would come from the browser agent)
if (typeof window !== 'undefined') {
  setTimeout(() => { connectionState.value = 'connecting'; }, 500);
  setTimeout(() => { connectionState.value = 'connected'; }, 1500);
  setTimeout(() => { connectionState.value = 'registered'; }, 2500);
}
</script>

<style scoped>
.container {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 2rem;
}

.card {
  background: white;
  border-radius: 16px;
  padding: 3rem;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
  max-width: 500px;
  width: 100%;
}

h1 {
  font-size: 2rem;
  color: #1a1a2e;
  margin-bottom: 0.5rem;
  text-align: center;
}

.subtitle {
  color: #666;
  text-align: center;
  margin-bottom: 2rem;
}

.pack-info {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 12px;
  padding: 1.5rem;
  margin-bottom: 2rem;
  color: white;
}

.pack-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  opacity: 0.8;
  margin-bottom: 0.25rem;
}

.pack-name {
  font-size: 1.5rem;
  font-weight: 600;
  font-family: 'Monaco', 'Menlo', monospace;
}

.status-section {
  margin-bottom: 2rem;
}

.status-section h2 {
  font-size: 1rem;
  color: #444;
  margin-bottom: 1rem;
}

.status-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem;
  background: #f8f9fa;
  border-radius: 8px;
}

.status-indicator {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background-color: #ccc;
  flex-shrink: 0;
}

.status-indicator.disconnected {
  background-color: #ef4444;
}

.status-indicator.connecting {
  background-color: #f59e0b;
  animation: pulse 1s infinite;
}

.status-indicator.connected {
  background-color: #3b82f6;
}

.status-indicator.registered {
  background-color: #22c55e;
}

.status-text {
  color: #555;
  font-size: 0.9rem;
}

.actions {
  text-align: center;
}

.btn {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  padding: 1rem 2rem;
  border-radius: 8px;
  font-size: 1rem;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}

.btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 20px -5px rgba(102, 126, 234, 0.4);
}

.btn:active {
  transform: translateY(0);
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
</style>
