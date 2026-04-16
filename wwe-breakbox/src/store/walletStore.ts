import { create } from 'zustand';

interface WalletState {
  balance: number;
  setBalance: (balance: number) => void;
}

export const useWalletStore = create<WalletState>((set) => ({
  balance: 0,
  setBalance: (balance) => set({ balance }),
}));
