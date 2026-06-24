import { create } from 'zustand';
import type { Toast, ModalState, ModalType } from '@billfree/web-core';

interface UiState {
  activeView:  string;
  darkMode:    boolean;
  sidebarOpen: boolean;
  toasts:      Toast[];
  modal:       ModalState;

  setView:        (v: string) => void;
  toggleDarkMode: () => void;
  applyDarkMode:  (dark: boolean) => void;
  toggleSidebar:  () => void;
  showToast:      (message: string, type?: Toast['type'], durationMs?: number) => void;
  dismissToast:   (id: number) => void;
  openModal:      (type: ModalType, data?: unknown) => void;
  closeModal:     () => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  activeView:  'dashboard',
  darkMode:    false,
  sidebarOpen: true,
  toasts:      [],
  modal:       { type: null },

  setView: (view) => set({ activeView: view }),

  toggleDarkMode: () => get().applyDarkMode(!get().darkMode),

  applyDarkMode: (dark) => {
    set({ darkMode: dark });
    localStorage.setItem('billfree_darkMode', String(dark));
    if (dark) {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  },

  toggleSidebar: () => set(s => ({ sidebarOpen: !s.sidebarOpen })),

  showToast: (message, type = 'info', durationMs = 4500) => {
    const id = Date.now();
    set(s => ({ toasts: [...s.toasts, { id, message, type }] }));
    setTimeout(() => {
      set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }));
    }, durationMs);
  },

  dismissToast: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),

  openModal:  (type, data) => set({ modal: { type, data } }),
  closeModal: ()           => set({ modal: { type: null } }),
}));
