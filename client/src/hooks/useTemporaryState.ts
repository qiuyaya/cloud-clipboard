import { useState, useRef, useCallback, useEffect } from "react";

/**
 * A hook that provides a state value that automatically resets after a duration.
 * Useful for success feedback, copied states, etc.
 */
export function useTemporaryState<T>(
  initialValue: T,
  duration: number = 2000,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(initialValue);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialValueRef = useRef(initialValue);

  const setTemporaryValue = useCallback(
    (newValue: T) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      setValue(newValue);
      timeoutRef.current = setTimeout(() => {
        setValue(initialValueRef.current);
        timeoutRef.current = null;
      }, duration);
    },
    [duration],
  );

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return [value, setTemporaryValue];
}
