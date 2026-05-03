import { useState, useEffect } from "react";

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

  useEffect(() => {
    if (!window.visualViewport) return;

    const updateState = () => {
      const vv = window.visualViewport!;
      const isKeyboardOpen = vv.height < window.innerHeight - 50;
      setState({
        isKeyboardOpen,
        keyboardHeight: isKeyboardOpen ? window.innerHeight - vv.height : 0,
        viewportOffsetTop: vv.offsetTop,
        viewportWidth: vv.width,
      });
    };

    updateState();
    window.visualViewport.addEventListener("resize", updateState);
    window.visualViewport.addEventListener("scroll", updateState);

    return () => {
      window.visualViewport?.removeEventListener("resize", updateState);
      window.visualViewport?.removeEventListener("scroll", updateState);
    };
  }, []);

  return state;
}
