import { useCallback, useState } from "react";
import type { TextInputSelectionChangeEvent } from "react-native";

/**
 * Works around an Android/Fabric bug where a controlled TextInput's cursor
 * jumps back to just before the last typed/deleted character whenever the
 * field is pre-filled with existing text (e.g. editing a name). Explicitly
 * echoing the native selection back as a controlled prop keeps the cursor
 * where the user left it.
 */
export function useTextSelectionFix() {
  const [selection, setSelection] = useState<
    { start: number; end: number } | undefined
  >(undefined);

  const onSelectionChange = useCallback((e: TextInputSelectionChangeEvent) => {
    setSelection(e.nativeEvent.selection);
  }, []);

  const resetSelection = useCallback(() => setSelection(undefined), []);

  return { selection, onSelectionChange, resetSelection };
}
