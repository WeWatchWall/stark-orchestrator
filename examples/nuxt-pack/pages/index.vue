<template>
  <div class="container">
    <div class="card">
      <!-- Logo using imported asset -->
      <div class="logo-container">
        <img :src="logoSrc" alt="Stark Logo" class="logo" />
      </div>
      
      <h1>🚀 Nuxt Bundle Example</h1>
      <p class="subtitle">A self-contained Nuxt app bundle with inlined assets</p>
      
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

      <!-- Asset Demo Section -->
      <div class="asset-demo">
        <h3>📦 Bundled Assets Demo</h3>
        <div class="asset-row">
          <div class="asset-preview">
            <img :src="logoSrc" alt="Logo" />
          </div>
          <div class="asset-info">
            <div class="asset-name">logo.svg</div>
            <div class="asset-type">SVG Image (inlined as base64)</div>
          </div>
        </div>
        <div class="asset-row">
          <div class="asset-preview">
            <img :src="checkIconSrc" alt="Check Icon" />
          </div>
          <div class="asset-info">
            <div class="asset-name">icon-check.svg</div>
            <div class="asset-type">SVG Icon (inlined as base64)</div>
          </div>
        </div>
        <ul class="check-list">
          <li>Dynamic imports disabled</li>
          <li>Assets inlined as base64</li>
          <li>CSS fully embedded</li>
        </ul>
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

// Import assets - Vite will handle these at build time
import logoSrc from '~/assets/images/logo.svg';
import checkIconSrc from '~/assets/images/icon-check.svg';

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

/* Asset Demo Section */
.asset-demo {
  margin-top: 2rem;
  margin-bottom: 2rem;
  padding: 1.5rem;
  background: #f8fafc;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
}

.asset-demo h3 {
  font-size: 0.875rem;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 1rem;
}

.asset-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.asset-preview {
  width: 48px;
  height: 48px;
  border-radius: 8px;
  overflow: hidden;
  background: white;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
}

.asset-preview img {
  max-width: 100%;
  max-height: 100%;
}

.asset-info {
  flex: 1;
}

.asset-name {
  font-weight: 500;
  color: #1e293b;
}

.asset-type {
  font-size: 0.75rem;
  color: #94a3b8;
}

.check-list {
  list-style: none;
  padding: 0;
  margin: 1rem 0 0 0;
}

.check-list li {
  display: flex;
  align-items: center;
  padding: 0.5rem 0;
  color: #374151;
  font-size: 0.9rem;
}

.check-list li::before {
  content: '✓';
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  margin-right: 0.75rem;
  background: #dcfce7;
  color: #22c55e;
  border-radius: 50%;
  font-size: 0.7rem;
  font-weight: bold;
}

/* Logo */
.logo-container {
  text-align: center;
  margin-bottom: 1.5rem;
}

.logo {
  width: 64px;
  height: 64px;
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
