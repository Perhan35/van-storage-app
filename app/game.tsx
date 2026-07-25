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
import { listAllItems, listAllZonesWithCounts } from "../src/db/repository";
import { ZoneWithCount } from "../src/db/database";
import { GameQuestion, ItemWithZoneName, generateQuestion, questionKey } from "../src/game/questions";

const ADVANCE_DELAY_MS = 1200;

export default function GameScreen() {
  const { t } = useTranslation();
  const { palette } = useAppTheme();
  // VanLayoutSVG reads its zones straight from the store (always the active
  // location); poolZones below is the separate, app-wide pool used to pick
  // question subjects, decoupled from whichever location is on screen.
  const activeLocationId = useAppStore((s) => s.activeLocationId);
  const setActiveLocation = useAppStore((s) => s.setActiveLocation);
  const setHighlightedZoneId = useAppStore((s) => s.setHighlightedZoneId);

  const [items, setItems] = useState<ItemWithZoneName[]>([]);
  const [poolZones, setPoolZones] = useState<ZoneWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [switchingLocation, setSwitchingLocation] = useState(false);
  const [question, setQuestion] = useState<GameQuestion | null>(null);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [answered, setAnswered] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [result, setResult] = useState<"correct" | "wrong" | null>(null);
  const [feedbackKey, setFeedbackKey] = useState("");

  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Restore the location that was active when the game screen was opened,
  // so quizzing across locations doesn't leave the rest of the app on
  // whichever location the last "where is" question happened to land on.
  const initialLocationId = useRef<string | null>(null);

  useEffect(() => {
    initialLocationId.current = activeLocationId;
    let cancelled = false;
    Promise.all([listAllItems(), listAllZonesWithCounts()]).then(([itemData, zoneData]) => {
      if (cancelled) return;
      setItems(itemData);
      setPoolZones(zoneData);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loading && question === null) {
      advanceQuestion();
    }
    // Only re-run when loading finishes; question generation afterwards is
    // driven explicitly by resolveAnswer, not by items/poolZones changing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  useEffect(() => {
    return () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
      setHighlightedZoneId(null);
      const initial = initialLocationId.current;
      if (initial && initial !== useAppStore.getState().activeLocationId) {
        setActiveLocation(initial);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setHighlightedZoneId]);

  // A "zone" question can be about an item in a location other than the one
  // currently on screen; the van map only draws the active location's
  // zones, so switch to the item's location first when that happens.
  const advanceQuestion = async (avoidKey?: string) => {
    const next = generateQuestion(items, poolZones, avoidKey);
    if (next && next.kind === "zone" && next.item.location_id !== useAppStore.getState().activeLocationId) {
      setSwitchingLocation(true);
      await setActiveLocation(next.item.location_id);
      setSwitchingLocation(false);
    }
    setQuestion(next);
  };

  const resolveAnswer = (isCorrect: boolean, selected: string, revealZoneId?: string) => {
    setAnswered(true);
    setSelectedKey(selected);
    setResult(isCorrect ? "correct" : "wrong");
    setFeedbackKey(`${Date.now()}`);
    setScore((s) => (isCorrect ? s + 1 : s));
    setStreak((s) => (isCorrect ? s + 1 : 0));
    if (revealZoneId) setHighlightedZoneId(revealZoneId);

    const answeredKey = question ? questionKey(question) : undefined;
    advanceTimer.current = setTimeout(() => {
      setAnswered(false);
      setSelectedKey(null);
      setResult(null);
      setHighlightedZoneId(null);
      advanceQuestion(answeredKey);
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

  if (loading || switchingLocation) {
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
