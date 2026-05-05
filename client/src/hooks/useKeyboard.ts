import { useState, useEffect, useRef } from "react";

interface KeyboardState {
  isKeyboardOpen: boolean;
  keyboardHeight: number;
  viewportOffsetTop: number;
  viewportWidth: number;
}

export function useKeyboard(): KeyboardState {
  const [state, setState] = useState<KeyboardState>({
    isKeyboardOpen: false,
    keyboardHeight: 0,
    viewportOffsetTop: 0,
    viewportWidth: window.innerWidth,
  });
  const prevStateRef = useRef<KeyboardState>(state);

  useEffect(() => {
    if (!window.visualViewport) return;

    let rafId = 0;

    const updateState = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const vv = window.visualViewport!;
        const isKeyboardOpen = vv.height < window.innerHeight - 50;
        const newState: KeyboardState = {
          isKeyboardOpen,
          keyboardHeight: isKeyboardOpen ? window.innerHeight - vv.height : 0,
          viewportOffsetTop: vv.offsetTop,
          viewportWidth: vv.width,
        };
        // Only update if something actually changed
        if (
          prevStateRef.current.isKeyboardOpen !== newState.isKeyboardOpen ||
          prevStateRef.current.keyboardHeight !== newState.keyboardHeight ||
          prevStateRef.current.viewportOffsetTop !== newState.viewportOffsetTop ||
          prevStateRef.current.viewportWidth !== newState.viewportWidth
        ) {
          prevStateRef.current = newState;
          setState(newState);
        }
      });
    };

    updateState();
    window.visualViewport.addEventListener("resize", updateState);
    window.visualViewport.addEventListener("scroll", updateState);

    return () => {
      cancelAnimationFrame(rafId);
      window.visualViewport?.removeEventListener("resize", updateState);
      window.visualViewport?.removeEventListener("scroll", updateState);
    };
  }, []);

  return state;
}
