<template>
  <!-- 海外账号直接复用国内账号管理页面，保证卡片、筛选、检查、同步、删除和重登逻辑完全一致。 -->
  <AccountManagement scope="overseas" />
</template>

<script setup>
// 通过范围参数复用账号管理的完整业务逻辑，只替换平台集合和页面文案。
import AccountManagement from './AccountManagement.vue'
</script>
