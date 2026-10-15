// Helpers shared by the viewer's sections.
import { toast } from "../lib.js";

/**
 * Handle submits of forms matching `selector` inside `root`; errors become toasts.
 * Each section registers its own forms this way instead of one big switch.
 */
export function onSubmit(root, selector, handler) {
  root.addEventListener("submit", async (e) => {
    const form = e.target.closest(selector);
    if (!form) return;
    e.preventDefault();
    try {
      await handler(form, new FormData(form));
    } catch (err) {
      toast(err.message);
    }
  });
}

export const pct = (x) => `${Math.round(x * 100)}%`;
