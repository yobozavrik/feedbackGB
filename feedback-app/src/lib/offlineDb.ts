import type { FeedbackPayload } from "./types";

export interface OfflineSubmission {
  id: string;                         // Локальный ID записи в IndexedDB (UUID/timestamp)
  client_submission_id: string;       // UUID для дедупликации (идемпотентность)

  submitter_uid: string;              // UID продавца на момент заполнения формы
  submitter_store_id: number | null;  // ID магазина
  submitter_name: string;             // Имя продавца для отображения в интерфейсе очереди

  payload: FeedbackPayload;           // Полная структура полезной нагрузки, включая фото, товары и т.д.

  client_created_at: string;          // ISO-время заполнения формы продавцом (создается ДО отправки)
  status: "pending" | "syncing" | "failed_auth" | "failed_validation";
  attempts: number;                   // Число попыток отправки
  last_error?: string;                // Текст последней ошибки от сервера
  last_attempt_at?: string;
}

const DB_NAME = "feedback_offline_db";
const STORE_NAME = "pending_submissions";
const DB_VERSION = 1;
const MAX_QUEUE_COUNT = 20;
const MAX_QUEUE_SIZE_BYTES = 40 * 1024 * 1024; // 40 MB

function getDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB is not supported on this environment"));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
  });
}

function getQueueCount(db: IDBDatabase): Promise<number> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getQueueSize(db: IDBDatabase): Promise<number> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      const items = request.result as OfflineSubmission[];
      let size = 0;
      for (const item of items) {
        size += JSON.stringify(item).length * 2;
      }
      resolve(size);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function saveOfflineSubmission(submission: OfflineSubmission): Promise<void> {
  const db = await getDb();
  
  // 1. Check count limit
  const count = await getQueueCount(db);
  if (count >= MAX_QUEUE_COUNT) {
    throw new Error(`Черга переповнена: макс ${MAX_QUEUE_COUNT} відгуків`);
  }

  // 2. Check size limit
  const currentSize = await getQueueSize(db);
  const newRecordSize = JSON.stringify(submission).length * 2;
  if (currentSize + newRecordSize > MAX_QUEUE_SIZE_BYTES) {
    throw new Error("Недостатньо вільного місця для збереження відгуку (максимальний обсяг черги 40 МБ)");
  }

  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);

    try {
      store.put(submission);
    } catch (err) {
      if (err instanceof Error && err.name === "QuotaExceededError") {
        reject(new Error("Помилка: Перевищено лімит пам'яті пристрою (QuotaExceededError)"));
      } else {
        reject(err);
      }
    }
  });
}

export async function getOfflineSubmissions(): Promise<OfflineSubmission[]> {
  try {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return [];
  }
}

export async function deleteOfflineSubmission(id: string): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    store.delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function updateOfflineSubmissionStatus(
  id: string,
  updates: Partial<Pick<OfflineSubmission, "status" | "attempts" | "last_error" | "last_attempt_at">>
): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const record = getReq.result as OfflineSubmission;
      if (!record) {
        reject(new Error("Record not found"));
        return;
      }
      const updated = { ...record, ...updates };
      const putReq = store.put(updated);
      putReq.onerror = () => reject(putReq.error);
    };
    
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function resetSyncingToPending(): Promise<void> {
  try {
    const db = await getDb();
    const submissions = await getOfflineSubmissions();
    const syncing = submissions.filter((s) => s.status === "syncing");
    if (syncing.length === 0) return;
    
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    for (const item of syncing) {
      store.put({ ...item, status: "pending" });
    }
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (e) {
    console.error("Failed to reset syncing to pending", e);
  }
}
