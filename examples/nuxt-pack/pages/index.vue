<template>
  <div class="container">
    <div class="card">
      <h1>🚀 Nuxt Bundle Example</h1>
      <p class="subtitle">A self-contained Nuxt app bundle</p>
      
      <div class="info-box">
        <div class="info-label">Bundle Name:</div>
        <div class="info-value">{{ bundleName }}</div>
      </div>

      <div class="status-section">
        <h2>Environment</h2>
        <div class="status-item">
          <span class="status-indicator" :class="environmentType"></span>
          <span class="status-text">{{ environmentText }}</span>
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
import { ref, computed, onMounted } from 'vue';

const bundleName = ref('nuxt-pack-example');
const environmentType = ref<'unknown' | 'browser' | 'worker'>('unknown');
const counter = ref(0);

const environmentText = computed(() => {
  switch (environmentType.value) {
    case 'browser': return 'Running in browser with DOM';
    case 'worker': return 'Running in worker context';
    default: return 'Detecting environment...';
  }
});

function incrementCounter() {
  counter.value++;
}

// Detect the execution environment
onMounted(() => {
  if (typeof document !== 'undefined') {
    environmentType.value = 'browser';
  } else if (typeof self !== 'undefined') {
    environmentType.value = 'worker';
  }
});
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

.info-box {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 12px;
  padding: 1.5rem;
  margin-bottom: 2rem;
  color: white;
}

.info-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  opacity: 0.8;
  margin-bottom: 0.25rem;
}

.info-value {
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

.status-indicator.unknown {
  background-color: #f59e0b;
  animation: pulse 1s infinite;
}

.status-indicator.browser {
  background-color: #22c55e;
}

.status-indicator.worker {
  background-color: #3b82f6;
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
