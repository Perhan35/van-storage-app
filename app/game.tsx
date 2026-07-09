import React, { useEffect, useRef, useState } from "react";
import { View, StyleSheet } from "react-native";
import { Text, ActivityIndicator } from "react-native-paper";
import { useTranslation } from "react-i18next";
import { VanLayoutSVG } from "../src/components/VanLayoutSVG";
import { GameHud } from "../src/components/game/GameHud";
import { QuestionBanner } from "../src/components/game/QuestionBanner";
import { AnswerButtons, AnswerChoice } from "../src/components/game/AnswerButtons";
import { FeedbackOverlay } from "../src/components/game/FeedbackOverlay";
import { useAppStore } from "../src/store/useAppStore";
import { useAppTheme } from "../src/theme/useAppTheme";
import { listAllItems } from "../src/db/repository";
import { GameQuestion, ItemWithZoneName, generateQuestion, questionKey } from "../src/game/questions";

const ADVANCE_DELAY_MS = 1200;

export default function GameScreen() {
  const { t } = useTranslation();
  const { palette } = useAppTheme();
  const zones = useAppStore((s) => s.zones);
  const setHighlightedZoneId = useAppStore((s) => s.setHighlightedZoneId);

  const [items, setItems] = useState<ItemWithZoneName[]>([]);
  const [loading, setLoading] = useState(true);
  const [question, setQuestion] = useState<GameQuestion | null>(null);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [answered, setAnswered] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [result, setResult] = useState<"correct" | "wrong" | null>(null);
  const [feedbackKey, setFeedbackKey] = useState("");

  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAllItems().then((data) => {
      if (cancelled) return;
      setItems(data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loading && question === null) {
      setQuestion(generateQuestion(items, zones));
    }
    // Only re-run when loading finishes; question generation afterwards is
    // driven explicitly by resolveAnswer, not by items/zones changing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  useEffect(() => {
    return () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
      setHighlightedZoneId(null);
    };
  }, [setHighlightedZoneId]);

  const resolveAnswer = (isCorrect: boolean, selected: string, revealZoneId?: string) => {
    setAnswered(true);
    setSelectedKey(selected);
    setResult(isCorrect ? "correct" : "wrong");
    setFeedbackKey(`${Date.now()}`);
    setScore((s) => (isCorrect ? s + 1 : s));
    setStreak((s) => (isCorrect ? s + 1 : 0));
    if (revealZoneId) setHighlightedZoneId(revealZoneId);

    advanceTimer.current = setTimeout(() => {
      setAnswered(false);
      setSelectedKey(null);
      setResult(null);
      setHighlightedZoneId(null);
      setQuestion((prev) => generateQuestion(items, zones, prev ? questionKey(prev) : undefined));
    }, ADVANCE_DELAY_MS);
  };

  const handleZonePress = (zoneId: string) => {
    if (!question || question.kind !== "zone" || answered) return;
    resolveAnswer(zoneId === question.correctZoneId, zoneId, question.correctZoneId);
  };

  const handleChoiceSelect = (key: string) => {
    if (!question || answered) return;
    if (question.kind === "season") {
      resolveAnswer(key === question.correct, key);
    } else if (question.kind === "quantity") {
      resolveAnswer(Number(key) === question.correct, key);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: palette.background }]}>
        <ActivityIndicator size="large" color={palette.primary} />
      </View>
    );
  }

  if (!question) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: palette.background }]}>
        <Text
          variant="titleMedium"
          style={[styles.emptyTitle, { color: palette.onSurface }]}
        >
          {t("game.empty_title")}
        </Text>
        <Text style={{ color: palette.onSurfaceVariant, textAlign: "center" }}>
          {t("game.empty_desc")}
        </Text>
      </View>
    );
  }

  let questionText = "";
  let choices: AnswerChoice[] = [];
  let correctKey: string | null = null;

  if (question.kind === "zone") {
    questionText = t("game.question_zone", { item: question.item.name });
  } else if (question.kind === "season") {
    questionText = t("game.question_season", { item: question.item.name });
    choices = [
      { key: "summer", label: t("game.season_summer"), icon: "weather-sunny" },
      { key: "winter", label: t("game.season_winter"), icon: "snowflake" },
      { key: "none", label: t("game.season_none"), icon: "minus-circle-outline" },
    ];
    if (answered) correctKey = question.correct;
  } else {
    questionText = t("game.question_quantity", { zone: question.zone.name });
    choices = question.choices.map((n) => ({ key: String(n), label: String(n) }));
    if (answered) correctKey = String(question.correct);
  }

  const isZoneQuestion = question.kind === "zone";

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <View style={styles.topSection}>
        <GameHud score={score} streak={streak} />
        <QuestionBanner text={questionText} questionKey={questionKey(question)} />
        {isZoneQuestion && (
          <View style={styles.tapHint}>
            <Text style={[styles.tapHintText, { color: palette.onSurfaceVariant }]}>
              {t("game.tap_zone")}
            </Text>
          </View>
        )}
      </View>

      {/* The van map is only shown for "which zone" questions — hidden the
          rest of the time, and given the remaining space below the question
          banner (rather than sitting full-bleed underneath it) so every
          zone, including the ones near the top, stays reachable. */}
      {isZoneQuestion ? (
        <View style={styles.mapArea}>
          <VanLayoutSVG onZonePress={handleZonePress} />
        </View>
      ) : (
        <View style={styles.answerArea}>
          <AnswerButtons
            choices={choices}
            disabled={answered}
            correctKey={correctKey}
            selectedKey={selectedKey}
            onSelect={handleChoiceSelect}
          />
        </View>
      )}

      <FeedbackOverlay result={result} feedbackKey={feedbackKey} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { justifyContent: "center", alignItems: "center", padding: 24 },
  emptyTitle: { textAlign: "center", marginBottom: 8 },
  topSection: { paddingBottom: 4 },
  mapArea: { flex: 1 },
  answerArea: { flex: 1, justifyContent: "center" },
  tapHint: { alignItems: "center", marginTop: 10 },
  tapHintText: { fontSize: 13, fontStyle: "italic" },
});
