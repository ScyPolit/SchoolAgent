// Extracted and adapted from LibreChat v0.8.1 useTextarea, MIT.
// Preserves the upstream composition guard for Safari / Chinese input methods.
import { useRef, useCallback } from 'react';

export function handleComposerKey(event, { composing, isSubmitting, submit }) {
  const isComposingInput = composing || event.nativeEvent?.isComposing || event.key === 'Process' || event.keyCode === 229;
  const isNonShiftEnter = event.key === 'Enter' && !event.shiftKey;
  const isCtrlEnter = event.key === 'Enter' && (event.ctrlKey || event.metaKey);
  if (isComposingInput || !(isNonShiftEnter || isCtrlEnter)) return;
  event.preventDefault();
  if (!isSubmitting) submit();
}

export default function useTextarea({ submitButtonRef, isSubmitting = false }) {
  const isComposing = useRef(false);
  const handleKeyDown = useCallback((event) => handleComposerKey(event, {
    composing: isComposing.current,
    isSubmitting,
    submit: () => submitButtonRef.current?.click(),
  }), [isSubmitting, submitButtonRef]);
  return {
    handleKeyDown,
    handleCompositionStart: () => { isComposing.current = true; },
    handleCompositionEnd: () => { isComposing.current = false; },
  };
}
