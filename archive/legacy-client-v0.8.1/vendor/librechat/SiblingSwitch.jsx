// Derived from LibreChat v0.8.1, MIT. See third_party/librechat/NOTICE.md.
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function SiblingSwitch({ siblingIdx, siblingCount, setSiblingIdx, disabled = false }) {
  if (siblingIdx === undefined || siblingCount === undefined) return null;
  const previous = () => setSiblingIdx && setSiblingIdx(siblingIdx - 1);
  const next = () => setSiblingIdx && setSiblingIdx(siblingIdx + 1);
  return siblingCount > 1 ? (
    <nav className="librechat-sibling-switch" aria-label="回答版本导航">
      <button className="icon-button" type="button" onClick={previous}
        disabled={disabled || siblingIdx === 0} aria-label="上一个回答版本"
        aria-disabled={disabled || siblingIdx === 0}>
        <ChevronLeft size={17} aria-hidden="true" />
      </button>
      <span aria-live="polite" aria-atomic="true" role="status">{siblingIdx + 1} / {siblingCount}</span>
      <button className="icon-button" type="button" onClick={next}
        disabled={disabled || siblingIdx === siblingCount - 1} aria-label="下一个回答版本"
        aria-disabled={disabled || siblingIdx === siblingCount - 1}>
        <ChevronRight size={17} aria-hidden="true" />
      </button>
    </nav>
  ) : null;
}
