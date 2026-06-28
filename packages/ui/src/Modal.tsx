import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';

interface Props {
  isOpen:    boolean;
  onClose:   () => void;
  title?:    string;
  children:  ReactNode;
  maxWidth?: string;
  id?:       string;
}

// Elements that can receive keyboard focus — used to scope the focus trap.
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Modal({
  isOpen, onClose, title, children, maxWidth = '560px', id,
}: Props) {
  const modalRef = useRef<HTMLDivElement>(null);
  // Remember what had focus before the modal opened, to restore it on close.
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();

  // Esc to close + focus trap. Keyboard users must not be able to Tab out of an
  // open dialog into the background content (WCAG 2.1 dialog requirement).
  useEffect(() => {
    if (!isOpen) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    // Move focus into the dialog on open (first focusable, else the container).
    const focusFirst = () => {
      const node = modalRef.current;
      if (!node) return;
      const focusables = node.querySelectorAll<HTMLElement>(FOCUSABLE);
      (focusables[0] ?? node).focus();
    };
    focusFirst();

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      const node = modalRef.current;
      if (!node) return;
      const focusables = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      // Wrap focus at the edges to keep it inside the dialog.
      if (e.shiftKey && (active === first || active === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      // Restore focus to whatever opened the modal (if still in the DOM).
      previouslyFocused.current?.focus?.();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="modal"
        style={{ maxWidth }}
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        // Reference the visible title rather than duplicating it via aria-label,
        // so screen readers announce it once.
        {...(title ? { 'aria-labelledby': titleId } : {})}
        id={id}
        tabIndex={-1}
      >
        {title && (
          <div className="modal-header">
            <h2 className="modal-title" id={titleId}>{title}</h2>
            <button
              className="modal-close-btn"
              onClick={onClose}
              aria-label="Close modal"
            >
              ×
            </button>
          </div>
        )}
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
