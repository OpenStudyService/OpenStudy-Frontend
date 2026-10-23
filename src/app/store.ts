import { create } from "zustand";
export type Theme = "forest" | "navy" | "sand";
function savedTheme(): Theme {
  try {
    const t = localStorage.getItem("openstudy-theme");
    if (t === "navy" || t === "sand") return t;
  } catch {
    /* restricted storage */
  }
  return "forest";
}
interface UiState {
  theme: Theme;
  navOpen: boolean;
  drafts: Record<string, string>;
  notice: string;
  setTheme: (theme: Theme) => void;
  setNav: (open: boolean) => void;
  setDraft: (key: string, text: string) => void;
  clearPrivate: () => void;
  toast: (text: string) => void;
}
let timer: ReturnType<typeof setTimeout> | undefined;
export const useUi = create<UiState>((set) => ({
  theme: savedTheme(),
  navOpen: false,
  drafts: {},
  notice: "",
  setTheme: (theme) => {
    try {
      localStorage.setItem("openstudy-theme", theme);
    } catch {
      /* current window */
    }
    set({ theme });
  },
  setNav: (navOpen) => set({ navOpen }),
  setDraft: (key, text) =>
    set((s) => ({ drafts: { ...s.drafts, [key]: text } })),
  clearPrivate: () => {
    clearTimeout(timer);
    set({ drafts: {}, navOpen: false, notice: "" });
  },
  toast: (notice) => {
    clearTimeout(timer);
    set({ notice });
    timer = setTimeout(() => set({ notice: "" }), 4500);
  },
}));
