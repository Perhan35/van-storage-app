import React, { useRef } from "react";
import { Dialog, Portal, Text, Button } from "react-native-paper";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "../../theme/useAppTheme";

export type DiscardPrompt = "session" | "outline";

type Props = {
  /**
   * What is being discarded, or null when no confirmation is asked for.
   * "session" leaves edit mode and reverts every zone move of the session;
   * "outline" reverts only the outline and stays in edit mode.
   */
  prompt: DiscardPrompt | null;
  onDismiss: () => void;
  onConfirm: () => void;
};

/**
 * Guards the ways out of edit mode — the header's ✕ and the Android back
 * button — since leaving throws away work with no undo behind it.
 */
export function DiscardEditChangesDialog({ prompt, onDismiss, onConfirm }: Props) {
  const { t } = useTranslation();
  const { palette } = useAppTheme();

  // Held past the prompt clearing: confirming an outline discard leaves
  // outline-edit at once, and the copy must not swap to the session wording
  // while the dialog is still fading out.
  const shown = useRef<DiscardPrompt>("session");
  if (prompt) shown.current = prompt;
  const isOutline = shown.current === "outline";

  return (
    <Portal>
      <Dialog visible={!!prompt} onDismiss={onDismiss}>
        <Dialog.Icon icon="alert-outline" color={palette.danger} size={28} />
        <Dialog.Title style={{ textAlign: "center" }}>
          {isOutline ? t("nav.discard_outline_title") : t("nav.discard_edit_title")}
        </Dialog.Title>
        <Dialog.Content>
          <Text variant="bodyMedium" style={{ textAlign: "center" }}>
            {isOutline ? t("nav.discard_outline_body") : t("nav.discard_edit_body")}
          </Text>
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={onDismiss}>{t("map.cancel")}</Button>
          <Button textColor={palette.danger} onPress={onConfirm}>
            {t("nav.discard_confirm")}
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}
