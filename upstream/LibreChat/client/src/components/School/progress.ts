import { atom } from 'jotai';

export type SchoolProgress = {
  phase: 'connecting' | 'processing' | 'generating';
  startedAt: number;
};
const values = atom<Record<string, SchoolProgress>>({});
export const schoolProgressFor = (messageId: string) => atom((get) => get(values)[messageId]);
export const updateSchoolProgress = atom(
  null,
  (get, set, action: { messageId?: string; progress?: SchoolProgress }) => {
    if (!action.messageId) return;
    const current = get(values);
    if (action.progress) set(values, { ...current, [action.messageId]: action.progress });
    else if (current[action.messageId]) {
      const next = { ...current };
      delete next[action.messageId];
      set(values, next);
    }
  },
);

export function readSchoolProgress(
  event: unknown,
): { messageId: string; progress: SchoolProgress } | undefined {
  const frame = event as {
    event?: unknown;
    data?: { runId?: unknown; campusProgress?: Partial<SchoolProgress> };
  } | null;
  const data = frame?.data,
    progress = data?.campusProgress;
  if (
    frame?.event !== 'on_agent_update' ||
    typeof data?.runId !== 'string' ||
    !data.runId ||
    data.runId.length > 200 ||
    !progress ||
    !['connecting', 'processing', 'generating'].includes(String(progress.phase)) ||
    typeof progress.startedAt !== 'number' ||
    !Number.isFinite(progress.startedAt) ||
    progress.startedAt <= 0
  )
    return;
  return {
    messageId: data.runId,
    progress: { phase: progress.phase as SchoolProgress['phase'], startedAt: progress.startedAt },
  };
}
