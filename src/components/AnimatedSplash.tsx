import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, useColorScheme } from "react-native";
import * as SplashScreen from "expo-splash-screen";

// Takes over from the native splash, pixel for pixel: same background (it
// follows the *phone's* light/dark mode, like the native one), same image at
// the same size (app.json `imageWidth`), centered the same way. The native
// image is the icon with its colored boxes erased (splash-icon-empty.png);
// here they pop in one by one, then the whole screen fades out to the app.

const ICON_SIZE = 200; // must match expo-splash-screen `imageWidth` in app.json
const SOURCE_SIZE = 1024; // pixel size of assets/splash-icon*.png
const k = ICON_SIZE / SOURCE_SIZE;

// Box geometry measured on the 1024px source image.
const BOX_W = 93 * k;
const BOX_H = 43 * k;
const BOX_RADIUS = 8 * k;
const COLS = [410.5, 520.5];
const ROWS = [388.5, 448.5, 508.5, 569.5];
const BOXES = [
  { col: 0, row: 0, color: "#FA7E57" },
  { col: 1, row: 0, color: "#707EC7" },
  { col: 0, row: 1, color: "#43B2A8" },
  { col: 1, row: 1, color: "#EF84A8" },
  { col: 0, row: 2, color: "#A7D178" },
  { col: 1, row: 2, color: "#B55EC4" },
  { col: 0, row: 3, color: "#FACD40" },
];

const BOX_DURATION = 250;
const BOX_STAGGER = 85; // 6 × 85 + 250 ≈ 0.76 s for all seven boxes
const FADE_DURATION = 300;
// Never hold the app back longer than this, even if loading isn't finished.
const MAX_WAIT_MS = 3000;

export function AnimatedSplash({ ready }: { ready: boolean }) {
  const scheme = useColorScheme();
  const background = scheme === "dark" ? "#121212" : "#ffffff";

  const boxes = useRef(BOXES.map(() => new Animated.Value(0))).current;
  const fade = useRef(new Animated.Value(1)).current;
  const started = useRef(false);
  const [boxesDone, setBoxesDone] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [finished, setFinished] = useState(false);

  const start = () => {
    if (started.current) return;
    started.current = true;
    // The overlay is now on screen and looks identical, so the native splash
    // can go without any visible change.
    SplashScreen.hideAsync().catch(() => {});
    Animated.stagger(
      BOX_STAGGER,
      boxes.map((v) =>
        Animated.timing(v, {
          toValue: 1,
          duration: BOX_DURATION,
          easing: Easing.out(Easing.back(1.8)),
          useNativeDriver: true,
        })
      )
    ).start(() => setBoxesDone(true));
  };

  useEffect(() => {
    // Fallback in case the image's load callback never fires.
    const startTimer = setTimeout(start, 500);
    const capTimer = setTimeout(() => setTimedOut(true), MAX_WAIT_MS);
    return () => {
      clearTimeout(startTimer);
      clearTimeout(capTimer);
    };
  }, []);

  useEffect(() => {
    if (!boxesDone || !(ready || timedOut)) return;
    Animated.timing(fade, {
      toValue: 0,
      duration: FADE_DURATION,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(() => setFinished(true));
  }, [boxesDone, ready, timedOut]);

  if (finished) return null;

  return (
    <Animated.View
      pointerEvents={boxesDone ? "none" : "auto"}
      style={[StyleSheet.absoluteFill, styles.container, { backgroundColor: background, opacity: fade }]}
    >
      <Animated.View
        style={{
          width: ICON_SIZE,
          height: ICON_SIZE,
          transform: [
            { scale: fade.interpolate({ inputRange: [0, 1], outputRange: [1.15, 1] }) },
          ],
        }}
      >
        <Animated.Image
          source={require("../../assets/splash-icon-empty.png")}
          style={{ width: ICON_SIZE, height: ICON_SIZE }}
          onLoadEnd={start}
          fadeDuration={0}
        />
        {BOXES.map((b, i) => (
          <Animated.View
            key={i}
            style={{
              position: "absolute",
              left: COLS[b.col] * k,
              top: ROWS[b.row] * k,
              width: BOX_W,
              height: BOX_H,
              borderRadius: BOX_RADIUS,
              backgroundColor: b.color,
              opacity: boxes[i],
              transform: [
                { scale: boxes[i].interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) },
              ],
            }}
          />
        ))}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { justifyContent: "center", alignItems: "center", zIndex: 1000 },
});
