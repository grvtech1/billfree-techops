import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Modal } from '@billfree/ui';

afterEach(cleanup);

function renderModal(props: Partial<React.ComponentProps<typeof Modal>> = {}) {
  const onClose = vi.fn();
  const utils = render(
    <Modal isOpen title="Edit Ticket" onClose={onClose} {...props}>
      <button>First</button>
      <button>Second</button>
    </Modal>,
  );
  return { onClose, ...utils };
}

describe('Modal accessibility + focus trap', () => {
  it('labels the dialog via aria-labelledby pointing at the visible title (not a duplicated aria-label)', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    expect(dialog).not.toHaveAttribute('aria-label');
    const labelId = dialog.getAttribute('aria-labelledby');
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId!)?.textContent).toBe('Edit Ticket');
  });

  it('moves focus into the dialog on open', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('closes on Escape', () => {
    const { onClose } = renderModal();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('traps Tab focus inside the dialog (wraps at the edges)', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('button'));
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    // Forward wrap: from the last element, Tab → first.
    last.focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    // Backward wrap: from the first element, Shift+Tab → last.
    first.focus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('closes on overlay click but not on inner content click', () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByText('First'));
    expect(onClose).not.toHaveBeenCalled();
    // The overlay is the dialog's parent (role=dialog is the inner panel).
    const overlay = screen.getByRole('dialog').parentElement!;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('restores focus to the previously-focused element on close', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Open';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const onClose = vi.fn();
    const { rerender } = render(
      <Modal isOpen title="X" onClose={onClose}>
        <button>Inside</button>
      </Modal>,
    );
    // Closing unmounts the dialog content and runs the cleanup → focus returns.
    rerender(
      <Modal isOpen={false} title="X" onClose={onClose}>
        <button>Inside</button>
      </Modal>,
    );
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
