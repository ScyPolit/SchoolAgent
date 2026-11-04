import type { TMessage } from 'librechat-data-provider';
import { buildThreadIndex } from '~/utils/thread';

/** Resolve exactly the path the original thread will show after selecting a
 * sibling. Saved descendants retain their own reversed sibling selections. */
export function visibleSchoolBranchLeaf(
  messages: (TMessage | undefined)[],
  target: TMessage,
  getSiblingIdx: (parentId: string) => number,
): TMessage | undefined {
  const index = buildThreadIndex(
    messages.filter(
      (message): message is TMessage =>
        message != null && message.conversationId === target.conversationId,
    ),
  );
  let cursor = index.messages.get(target.messageId);
  let leaf: TMessage | undefined;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.messageId)) {
    seen.add(cursor.messageId);
    if (!cursor.isCreatedByUser) leaf = cursor;
    const children = index.children.get(cursor.messageId) || [];
    if (!children.length) break;
    const value = getSiblingIdx(cursor.messageId);
    const reversed = Number.isInteger(value) && value >= 0 && value < children.length ? value : 0;
    cursor = index.messages.get(children[children.length - reversed - 1]);
  }
  return leaf;
}
