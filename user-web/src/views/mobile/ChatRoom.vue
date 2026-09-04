<!-- 忆梦云团队开发 - 手机端聊天房间独立视图 -->
<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ChatPanel from './ChatPanel.vue'
const route = useRoute()
const router = useRouter()
const conversationId = computed(() => route.params.id)
function back() { router.push('/m/messages') }
</script>
<template><main class="mobile-chat-room"><ChatPanel :conversation-id="conversationId" @back="back" /></main></template>
<style scoped>.mobile-chat-room{position:fixed;inset:0;overflow:hidden;background:#f8fafc}</style>
