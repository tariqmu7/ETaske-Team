import { useEffect, useRef } from 'react';

/**
 * Runs `fn` every `ms` while the tab is visible, and once straight away when
 * the tab comes back into view. Hidden tabs cost the Apps Script nothing.
 */
export function useVisibleInterval(fn: () => void, ms: number, enabled = true) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    const start = () => {
      window.clearInterval(timer);
      timer = window.setInterval(() => fnRef.current(), ms);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') { fnRef.current(); start(); }
      else window.clearInterval(timer);
    };
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ms, enabled]);
}
