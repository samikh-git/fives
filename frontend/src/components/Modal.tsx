import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function Modal({ title, onClose, children }: ModalProps) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Rendered via a portal straight onto <body>: the page shell (.stadium__screen) uses
  // backdrop-filter, which makes it the containing block for any `position: fixed`
  // descendant. Left inline, this modal would centre itself against the shell's full
  // (potentially very tall, scrolled-past) content height instead of the viewport -
  // on a long roster page that meant the dialog could render off-screen.
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>{title}</h2>
          <button className="modal__close" type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
