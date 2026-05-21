<template>
  <div class="app-container">
    <AppNavbar />
    <main class="main-content">
      <router-view />
    </main>
    <ChatWidget />
  </div>
</template>

<script setup lang="ts">
import AppNavbar from '@/components/layout/AppNavbar.vue';
import ChatWidget from '@/components/chat/ChatWidget.vue';
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #f5f7fa;
  color: #333;
}

.app-container {
  min-height: 100vh;
}

.main-content {
  max-width: 1200px;
  margin: 0 auto;
  padding: 60px 20px 20px;
}
</style>
