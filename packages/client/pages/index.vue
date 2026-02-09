<template>
  <div class="container">
    <h1>Hello World</h1>
    <p>Welcome to Stark Orchestrator</p>
    <div class="status">
      <span class="status-indicator" :class="connectionState"></span>
      <span>Node: production-browser-1 ({{ connectionState }})</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { createBrowserAgent, type BrowserAgent, type ConnectionState } from '@stark-o/browser-runtime';

const connectionState = ref<ConnectionState>('disconnected');
let agent: BrowserAgent | null = null;

onMounted(async () => {
  // Build WebSocket URL from current page URL
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  agent = createBrowserAgent({
    orchestratorUrl: wsUrl,
    nodeName: 'production-browser-1',
    runtimeType: 'browser',
    debug: true,
    // Enable full WebRTC networking for inter-service communication
    // The pack-worker.js is built by @stark-o/browser-runtime
    workerScriptUrl: '/_nuxt/pack-worker.js',
    // autoRegister defaults to true - will auto-register if public registration is enabled
  });

  // Listen for connection state changes
  agent.on((event, _data) => {
    if (event === 'connecting') connectionState.value = 'connecting';
    else if (event === 'connected') connectionState.value = 'connected';
    else if (event === 'authenticated') connectionState.value = 'authenticated';
    else if (event === 'registered') connectionState.value = 'registered';
    else if (event === 'disconnected') connectionState.value = 'disconnected';
    else if (event === 'reconnecting') connectionState.value = 'connecting';
  });

  try {
    await agent.start();
  } catch (error) {
    console.error('Failed to start browser agent:', error);
  }
});

onUnmounted(async () => {
  if (agent) {
    await agent.stop();
    agent = null;
  }
});
</script>

<style scoped>
.container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

h1 {
  font-size: 3rem;
  color: #1a1a1a;
  margin-bottom: 1rem;
}

p {
  font-size: 1.25rem;
  color: #666;
}

.status {
  margin-top: 2rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: #888;
}

.status-indicator {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background-color: #ccc;
}

.status-indicator.disconnected {
  background-color: #ef4444;
}

.status-indicator.connecting {
  background-color: #f59e0b;
  animation: pulse 1s infinite;
}

.status-indicator.connected,
.status-indicator.authenticating {
  background-color: #3b82f6;
}

.status-indicator.authenticated,
.status-indicator.registering {
  background-color: #8b5cf6;
}

.status-indicator.registered {
  background-color: #22c55e;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
</style>
