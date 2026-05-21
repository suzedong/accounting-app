import { defineStore } from 'pinia';
import { ref, nextTick } from 'vue';
import { dispatchLLM } from '@/ai/dispatch';
import { executeAction } from '@/ai/actions';
import { getChatHistory, saveChatMessage } from '@/api/tauri';

export interface ChatMessageItem {
  id: number;
  role: 'user' | 'ai';
  content: string;
  data?: unknown;
  render?: string;
  title?: string;
  loading?: boolean;
}

export const useChatStore = defineStore('chat', () => {
  const messages = ref<ChatMessageItem[]>([]);
  const isOpen = ref(false);
  const sending = ref(false);
  let nextId = 1;

  function genId() {
    return nextId++;
  }

  async function scrollToBottom(messagesRef: HTMLElement | null) {
    await nextTick();
    if (messagesRef) {
      messagesRef.scrollTop = messagesRef.scrollHeight;
    }
  }

  async function loadHistory(limit = 50) {
    try {
      const res = await getChatHistory(limit);
      const loaded: ChatMessageItem[] = [];
      for (const m of res.data.reverse()) {
        loaded.push({
          id: genId(),
          role: m.role as 'user' | 'ai',
          content: m.content || '',
          data: m.data ? JSON.parse(m.data) : undefined,
          render: 'text',
        });
      }
      messages.value = loaded;
    } catch {
      // No history or not yet configured
    }
  }

  async function sendMessage(text: string, messagesRef: HTMLElement | null): Promise<void> {
    if (!text.trim() || sending.value) return;

    sending.value = true;

    // Add user message
    messages.value.push({ id: genId(), role: 'user', content: text });
    await scrollToBottom(messagesRef);
    await persistMessage('user', text);

    // Add loading AI message
    const aiMsg: ChatMessageItem = { id: genId(), role: 'ai', content: '', loading: true };
    messages.value.push(aiMsg);
    await scrollToBottom(messagesRef);

    try {
      const dispatchResult = await dispatchLLM(text);
      const actionResult = await executeAction(dispatchResult);

      aiMsg.loading = false;
      aiMsg.render = actionResult.render;
      aiMsg.content = actionResult.message;
      aiMsg.data = actionResult.data;
      aiMsg.title = dispatchResult.title;

      await persistMessage('ai', actionResult.message, actionResult.data);
    } catch (e: unknown) {
      aiMsg.loading = false;
      aiMsg.content = e instanceof Error ? e.message : '未知错误';
      aiMsg.render = 'text';
      await persistMessage('ai', aiMsg.content);
    } finally {
      sending.value = false;
      await scrollToBottom(messagesRef);
    }
  }

  async function persistMessage(role: 'user' | 'ai', content: string, data?: unknown) {
    try {
      await saveChatMessage(
        role,
        content,
        data ? JSON.stringify(data) : null,
        null,
        null,
      );
    } catch {
      // Ignore persistence errors
    }
  }

  function clearMessages() {
    messages.value = [];
    nextId = 1;
  }

  return {
    messages, isOpen, sending,
    loadHistory, sendMessage, clearMessages,
  };
});
