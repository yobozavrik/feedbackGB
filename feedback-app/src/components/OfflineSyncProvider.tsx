"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  getOfflineSubmissions,
  deleteOfflineSubmission,
  updateOfflineSubmissionStatus,
  resetSyncingToPending,
  type OfflineSubmission,
} from "@/lib/offlineDb";

interface OfflineSyncContextProps {
  queue: OfflineSubmission[];
  isOnline: boolean;
  isSyncing: boolean;
  syncNow: () => Promise<void>;
  refreshQueue: () => Promise<void>;
}

interface MeResponse {
  user?: { uid?: string } | null;
}

const OfflineSyncContext = createContext<OfflineSyncContextProps | undefined>(undefined);

export function useOfflineSync() {
  const context = useContext(OfflineSyncContext);
  if (!context) {
    throw new Error("useOfflineSync must be used within an OfflineSyncProvider");
  }
  return context;
}

export function OfflineSyncProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<OfflineSubmission[]>([]);
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const currentUidRef = useRef<string | null>(null);
  const syncInProgressRef = useRef(false);

  const refreshQueue = useCallback(async () => {
    const list = await getOfflineSubmissions();
    const currentUid = currentUidRef.current;
    setQueue(currentUid ? list.filter((item) => item.submitter_uid === currentUid) : []);
  }, []);

  const syncNow = useCallback(async () => {
    if (syncInProgressRef.current || !navigator.onLine) return;
    syncInProgressRef.current = true;
    setIsSyncing(true);

    try {
      const authRes = await fetch("/api/auth/me").catch(() => null);
      if (!authRes || !authRes.ok) {
        currentUidRef.current = null;
        setQueue([]);
        return;
      }

      const authData = (await authRes.json().catch(() => null)) as MeResponse | null;
      const currentUid = authData?.user?.uid ?? null;
      currentUidRef.current = currentUid;
      if (!currentUid) {
        setQueue([]);
        return;
      }

      const list = await getOfflineSubmissions();
      const ownQueue = list.filter((item) => item.submitter_uid === currentUid);
      setQueue(ownQueue);

      const eligible = ownQueue.filter(
        (item) => item.status === "pending" || item.status === "failed_auth",
      );

      for (const item of eligible) {
        await updateOfflineSubmissionStatus(item.id, {
          status: "syncing",
          last_attempt_at: new Date().toISOString(),
          attempts: item.attempts + 1,
        });
        await refreshQueue();

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);

        try {
          const res = await fetch("/api/feedback", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(item.payload),
            signal: controller.signal,
          });
          clearTimeout(timeoutId);

          if (res.ok) {
            await deleteOfflineSubmission(item.id);
            continue;
          }

          const errText = await res.text().catch(() => "");
          let status: OfflineSubmission["status"] = "pending";
          if (res.status === 401 || res.status === 403) {
            status = "failed_auth";
          } else if (res.status === 400 || res.status === 409 || res.status === 413) {
            status = "failed_validation";
          }

          await updateOfflineSubmissionStatus(item.id, {
            status,
            last_error: errText || `HTTP ${res.status}`,
          });
        } catch (err) {
          clearTimeout(timeoutId);
          console.error("Offline sync request failed for:", item.id, err);
          await updateOfflineSubmissionStatus(item.id, {
            status: "pending",
            last_error: err instanceof Error ? err.message : "Помилка мережі",
          });
          break;
        }
      }

      await refreshQueue();
    } catch (e) {
      console.error("General sync error:", e);
    } finally {
      syncInProgressRef.current = false;
      setIsSyncing(false);
    }
  }, [refreshQueue]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    setIsOnline(navigator.onLine);

    const handleOnline = () => {
      setIsOnline(true);
      void syncNow();
    };
    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    resetSyncingToPending().then(() => {
      void refreshQueue();
      if (navigator.onLine) {
        void syncNow();
      }
    });

    const interval = setInterval(() => {
      if (navigator.onLine) {
        void syncNow();
      }
    }, 15000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(interval);
    };
  }, [refreshQueue, syncNow]);

  return (
    <OfflineSyncContext.Provider value={{ queue, isOnline, isSyncing, syncNow, refreshQueue }}>
      {children}
    </OfflineSyncContext.Provider>
  );
}
