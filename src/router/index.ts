import { createRouter, createWebHistory } from 'vue-router';

const routes = [
  {
    path: '/',
    name: 'home',
    component: () => import('@/views/Home.vue'),
    meta: { title: '首页' },
  },
  {
    path: '/records',
    name: 'records',
    component: () => import('@/views/Records.vue'),
    meta: { title: '记录' },
  },
  {
    path: '/budget',
    name: 'budget',
    component: () => import('@/views/Budget.vue'),
    meta: { title: '预算' },
  },
  {
    path: '/stats',
    name: 'stats',
    component: () => import('@/views/Stats.vue'),
    meta: { title: '统计' },
  },
  {
    path: '/trips',
    name: 'trips',
    component: () => import('@/views/TripAllowance.vue'),
    meta: { title: '差旅补助' },
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/views/Settings.vue'),
    meta: { title: '设置' },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to) => {
  if (to.meta.title) {
    document.title = `AI 记账 - ${to.meta.title}`;
  }
});

export default router;
