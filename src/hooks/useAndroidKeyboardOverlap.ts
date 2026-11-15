import { RefObject, useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";
import type { ViewInstance } from "react-native";

// How much of `containerRef`'s view the Android keyboard covers, so a list
// inside it can pad its content by that much and keep its last rows
// reachable. Measuring the overlap instead of using the raw keyboard
// height makes this right in both cases: if the window shrinks for the
// keyboard (`adjustResize`), nothing is covered and this stays 0; if it
// doesn't (edge-to-edge can stop it from resizing), it returns the covered part.
// iOS returns 0; use `automaticallyAdjustKeyboardInsets` there.
export function useAndroidKeyboardOverlap(containerRef: RefObject<ViewInstance | null>): number {
  const [overlap, setOverlap] = useState(0);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const show = Keyboard.addListener("keyboardDidShow", (e) => {
      const keyboardTop = e.endCoordinates.screenY;
      containerRef.current?.measureInWindow((_x, y, _w, h) => {
        setOverlap(Math.max(0, y + h - keyboardTop));
      });
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => setOverlap(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [containerRef]);

  return overlap;
}
