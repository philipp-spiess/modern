import { signal } from "@preact/signals-core";
import path from "node:path";
import { getGlobal, setGlobal } from "../../storage";

const THREAD_NOTIFICATIONS_SCOPE = "agent:thread-notifications:v1";
const THREAD_KEY_PREFIX = "thread:";

export const threadNotificationsRevision = signal(0);

function bumpThreadNotificationsRevision(): void {
  threadNotificationsRevision.value += 1;
}

interface ThreadNotificationRecord {
  unread?: boolean;
}

function toThreadStorageKey(threadPath: string): string {
  return `${THREAD_KEY_PREFIX}${path.resolve(threadPath)}`;
}

export function getThreadUnreadState(threadPath: string): boolean {
  const record = getGlobal<ThreadNotificationRecord>(THREAD_NOTIFICATIONS_SCOPE, toThreadStorageKey(threadPath), {
    unread: false,
  });

  return Boolean(record?.unread);
}

export async function setThreadUnreadState(threadPath: string, unread: boolean): Promise<void> {
  const key = toThreadStorageKey(threadPath);
  const current = getGlobal<ThreadNotificationRecord>(THREAD_NOTIFICATIONS_SCOPE, key, { unread: false });

  if (Boolean(current?.unread) === unread) {
    return;
  }

  await setGlobal(THREAD_NOTIFICATIONS_SCOPE, key, {
    unread,
  } satisfies ThreadNotificationRecord);
  bumpThreadNotificationsRevision();
}

export async function markThreadUnread(threadPath: string): Promise<void> {
  await setThreadUnreadState(threadPath, true);
}

export async function clearThreadUnread(threadPath: string): Promise<void> {
  await setThreadUnreadState(threadPath, false);
}
