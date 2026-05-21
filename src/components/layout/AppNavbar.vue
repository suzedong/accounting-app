<template>
  <nav class="navbar">
    <div class="navbar-inner">
      <h1 class="logo">AI 记账</h1>
      <div class="nav-links">
        <router-link
          v-for="link in links"
          :key="link.path"
          :to="link.path"
          class="nav-link"
          active-class="active"
        >
          {{ link.name }}
        </router-link>
      </div>
    </div>
  </nav>
</template>

<script setup lang="ts">
const links = [
  { name: '首页', path: '/' },
  { name: '记录', path: '/records' },
  { name: '预算', path: '/budget' },
  { name: '统计', path: '/stats' },
  { name: '差旅补助', path: '/trips' },
  { name: '设置', path: '/settings' },
];
</script>

<style scoped>
.navbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1000;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 0 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.navbar-inner {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 20px;
}

.logo {
  font-size: 1.4em;
  font-weight: 600;
  white-space: nowrap;
}

.nav-links {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.nav-link {
  color: rgba(255, 255, 255, 0.8);
  text-decoration: none;
  padding: 12px 16px;
  border-radius: 6px;
  transition: all 0.2s;
  font-size: 0.95em;
}

.nav-link:hover {
  background: rgba(255, 255, 255, 0.2);
  color: white;
}

.nav-link.active {
  background: rgba(255, 255, 255, 0.3);
  color: white;
  font-weight: 600;
}
</style>
