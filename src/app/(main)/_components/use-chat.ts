"use client";

import { create } from "zustand";

type Config = {
  selected: string | null;
};

type ChatStore = {
  chat: Config;
  setChat: (chat: Config) => void;
};

const useChatStore = create<ChatStore>((set) => ({
  chat: {
    selected: null,
  },
  setChat: (chat) => set({ chat }),
}));

export function useChat() {
  const chat = useChatStore((state) => state.chat);
  const setChat = useChatStore((state) => state.setChat);

  return [chat, setChat] as const;
}
