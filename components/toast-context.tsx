"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

export type ToastType = "success" | "error" | "info";

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
}

interface ToastContextType {
  toast: {
    success: (title: string, message?: string) => void;
    error: (title: string, message?: string) => void;
    info: (title: string, message?: string) => void;
  };
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef<number[]>([]);

  useEffect(
    () => () => {
      timers.current.forEach((timer) => window.clearTimeout(timer));
    },
    [],
  );

  const addToast = useCallback((type: ToastType, title: string, message?: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, type, title, message }]);

    const timer = window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
    timers.current.push(timer);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useMemo(
    () => ({
      success: (title: string, message?: string) => addToast("success", title, message),
      error: (title: string, message?: string) => addToast("error", title, message),
      info: (title: string, message?: string) => addToast("info", title, message),
    }),
    [addToast],
  );
  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-[20px] right-[20px] z-[150] flex flex-col gap-[10px] max-w-[380px] w-[calc(100vw_-_40px)] pointer-events-none" aria-live="polite" aria-atomic="true">
        {toasts.map((t) => (
          <div key={t.id} className={`toast-card flex items-start gap-[12px] py-[14px] px-[16px] rounded-card bg-[#17161c] border border-[#272532] [box-shadow:0_12px_30px_rgba(0,0,0,0.5)] toast-${t.type}`} role="alert">
            <div className="shrink-0 mt-[1px]">
              {t.type === "success" && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
              {t.type === "error" && <AlertCircle className="w-4 h-4 text-rose-400" />}
              {t.type === "info" && <Info className="w-4 h-4 text-blue-400" />}
            </div>
            <div className="flex-1 min-w-0">
              <strong className="block text-[13px] font-semibold text-ink">{t.title}</strong>
              {t.message && <p className="text-[12px] text-[#8c899c] mt-[2px] mb-0 mx-0 [word-break:break-word]">{t.message}</p>}
            </div>
            <button
              type="button"
              className="bg-transparent border-0 text-[#636170] cursor-pointer p-[2px] flex shrink-0 hover:text-ink"
              onClick={() => removeToast(t.id)}
              aria-label="Close notification"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    // Graceful fallback if used outside provider
    return {
      toast: {
        success: () => {},
        error: () => {},
        info: () => {},
      },
    };
  }
  return context;
}
