import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { ScrollViewInstance } from "react-native";
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { AnimatedFAB, Button, Divider, Icon, List, SegmentedButtons, Text } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../src/store/useAppStore";
import { getKitData, KitData, KitItem } from "../src/db/repository";
import { KitSeason, WantedItem } from "../src/db/database";
import { useAppTheme } from "../src/theme/useAppTheme";
import { HighlightFlashRow } from "../src/components/HighlightFlashRow";
import { SeasonChangeoverDialog } from "../src/components/dialogs/SeasonChangeoverDialog";
import { WantedItemDialog } from "../src/components/dialogs/WantedItemDialog";
import { FulfillWantedDialog } from "../src/components/dialogs/FulfillWantedDialog";
import { seasonForDate } from "../src/utils/season";

// The three groups a kit splits into, which the summary tiles filter on.
type Group = "van" | "home" | "missing";

// How many names the "still in the van" banner spells out before "…".
const BANNER_MAX_NAMES = 3;

// How long the "switch season" button shows its text before folding down
// to its icon alone.
const SWITCH_LABEL_MS = 3000;

function isKitSeason(v: unknown): v is KitSeason {
  return v === "winter" || v === "summer";
}

export default function KitScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const { palette } = useAppTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ season?: string; highlightWantedId?: string }>();
  const seasonMode = useAppStore((s) => s.seasonMode);
  const locations = useAppStore((s) => s.locations);
  // Frozen at mount, like search and the out-of-van screen: opened from a
  // location, the kit covers that location only; opened from the
  // all-locations overview, it covers every location.
  const [isGlobalView] = useState(() => useAppStore.getState().overviewMode);
  const [scopeLocationId] = useState(() => useAppStore.getState().activeLocationId);
  const setItemsOutOfVan = useAppStore((s) => s.setItemsOutOfVan);
  const addWantedItem = useAppStore((s) => s.addWantedItem);
  const updateWantedItem = useAppStore((s) => s.updateWantedItem);
  const deleteWantedItem = useAppStore((s) => s.deleteWantedItem);
  const fulfillWantedItem = useAppStore((s) => s.fulfillWantedItem);
  const setSeasonMode = useAppStore((s) => s.setSeasonMode);

  // Which kit is on screen. Only for looking: the app's own season (which
  // drives the changeover) is still set in Settings.
  const [season, setSeason] = useState<KitSeason>(() =>
    isKitSeason(params.season) ? params.season : seasonMode
  );
  const [data, setData] = useState<KitData | null>(null);
  // Transient on purpose, like the zone filters: a filter that silently
  // survives leaving the screen hides things and confuses.
  const [filter, setFilter] = useState<Group | null>(null);
  const [allYearOpen, setAllYearOpen] = useState(false);
  // undefined = closed, null = noting a new thing, else editing that one.
  const [wantedDialogItem, setWantedDialogItem] = useState<WantedItem | null | undefined>(undefined);
  const [fulfilling, setFulfilling] = useState<WantedItem | null>(null);
  const [changeoverVisible, setChangeoverVisible] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  // The season the calendar says it is. Refreshed on every focus, so a kit
  // left open in the background across a month change catches up.
  const [calendarSeason, setCalendarSeason] = useState<KitSeason>(() => seasonForDate(new Date()));
  const [switchExtended, setSwitchExtended] = useState(true);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const highlightHandledRef = useRef<string | null>(null);
  const pendingScrollIdRef = useRef<string | null>(null);
  // Each wanted row's y in the scroll content, from its last layout. The row
  // may lay out before or after the highlight effect runs, so both sides
  // check: whichever comes second does the scroll.
  const rowYRef = useRef(new Map<string, number>());

  // Stable identity: HighlightFlashRow restarts its flash when onDone changes.
  const handleHighlightDone = useCallback(() => setHighlightedId(null), []);

  const scrollToRow = (y: number) => {
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 160), animated: true });
  };

  const load = useCallback(async () => {
    try {
      setData(await getKitData());
    } catch (e) {
      console.warn("Loading the season kit failed", e);
    }
  }, []);

  // Reloads on every return to the screen: an item edited in its zone (its
  // season changed, say) must move groups here too.
  useFocusEffect(
    useCallback(() => {
      load();
      setCalendarSeason(seasonForDate(new Date()));
    }, [load])
  );

  // The calendar has moved on but the app's season hasn't: offer the switch.
  // No way to dismiss it; it goes away once the mode matches the calendar.
  const showSeasonSwitch = calendarSeason !== seasonMode;

  // Spell the button out first, then fold it to its icon so it stops
  // covering the list. Starts over each time the suggestion appears.
  useEffect(() => {
    if (!showSeasonSwitch) return;
    setSwitchExtended(true);
    const timer = setTimeout(() => setSwitchExtended(false), SWITCH_LABEL_MS);
    return () => clearTimeout(timer);
  }, [showSeasonSwitch]);

  // Arriving from search on a wanted item: show its season, clear any
  // filter that would hide it, then flash it once its row has laid out.
  useEffect(() => {
    const id = params.highlightWantedId;
    if (!id || !data || highlightHandledRef.current === id) return;
    const wanted = data.wanted.find((w) => w.id === id);
    if (!wanted) return;
    highlightHandledRef.current = id;
    setFilter(null);
    setHighlightedId(id);
    const knownY = rowYRef.current.get(id);
    if (wanted.season === season && knownY !== undefined) {
      scrollToRow(knownY);
    } else {
      // Its row isn't on screen yet (other season shown): scroll on layout.
      pendingScrollIdRef.current = id;
      setSeason(wanted.season);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.highlightWantedId, data]);

  useEffect(() => {
    const name = locations.find((l) => l.id === scopeLocationId)?.name;
    navigation.setOptions({
      title: isGlobalView || !name ? t("kit.title") : t("kit.title_named", { name }),
    });
  }, [navigation, isGlobalView, scopeLocationId, locations, t]);

  const kit = useMemo(() => {
    // Wanted items belong to no location (they have no zone yet), so they
    // show in every kit, scoped or not.
    const items = (data?.items ?? []).filter(
      (i) => isGlobalView || i.location_id === scopeLocationId
    );
    const opposite: KitSeason = season === "winter" ? "summer" : "winter";
    const inSeason = items.filter((i) => i.season === season);
    return {
      van: inSeason.filter((i) => !i.out_of_van),
      home: inSeason.filter((i) => !!i.out_of_van),
      missing: (data?.wanted ?? []).filter((w) => w.season === season),
      allYear: items.filter((i) => i.season === "none"),
      oppositeInVan: items.filter((i) => i.season === opposite && !i.out_of_van),
    };
  }, [data, season, isGlobalView, scopeLocationId]);

  const owned = kit.van.length + kit.home.length;
  const total = owned + kit.missing.length;
  const showLocationNames = isGlobalView && locations.length > 1;

  // A failed write leaves the data as it was; say so instead of failing
  // silently, then reload so the screen matches what is really stored.
  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      console.warn("Season kit action failed", e);
      Alert.alert(t("settings.error"), t("kit.save_error"));
    }
    await load();
  };

  const placeOf = (item: KitItem) =>
    showLocationNames ? `${item.location_name} · ${item.zone_name}` : item.zone_name;

  const openItem = (item: KitItem) => {
    router.push(`/zone/${item.zone_id}?highlightItemId=${item.id}`);
  };

  const handleSaveWanted = (name: string, wantedSeason: KitSeason, notes: string) => {
    const editing = wantedDialogItem;
    setWantedDialogItem(undefined);
    run(() =>
      editing
        ? updateWantedItem(editing.id, name, wantedSeason, notes)
        : addWantedItem(name, wantedSeason, notes)
    );
  };

  const handleDeleteWanted = (item: WantedItem) => {
    Alert.alert(t("zone.delete_alert", { name: item.name }), undefined, [
      { text: t("map.cancel"), style: "cancel" },
      {
        text: t("zone.delete"),
        style: "destructive",
        onPress: () => {
          setWantedDialogItem(undefined);
          run(() => deleteWantedItem(item.id));
        },
      },
    ]);
  };

  const handleFulfill = (item: WantedItem, zoneId: string, outOfVan: boolean) => {
    setFulfilling(null);
    run(() => fulfillWantedItem(item.id, zoneId, outOfVan));
  };

  const toggleFilter = (group: Group) => setFilter((f) => (f === group ? null : group));

  // Same as picking the season in Settings: change the app's mode, then
  // open the changeover list of what to take out and put back. The kit on
  // screen follows, since that is the season now being packed for.
  const handleSeasonSwitch = () => {
    const next = calendarSeason;
    setSeasonMode(next).catch((e) => console.warn("Saving the season mode failed", e));
    setSeason(next);
    setFilter(null);
    setChangeoverVisible(true);
  };

  const handleSeasonChange = (v: string) => {
    if (!isKitSeason(v)) return;
    setSeason(v);
    setFilter(null);
  };

  const shows = (group: Group) => filter === null || filter === group;

  const bannerNames =
    kit.oppositeInVan
      .slice(0, BANNER_MAX_NAMES)
      .map((i) => i.name)
      .join(", ") + (kit.oppositeInVan.length > BANNER_MAX_NAMES ? "…" : "");
  const oppositeSeason: KitSeason = season === "winter" ? "summer" : "winter";
  const showBanner = season === seasonMode && kit.oppositeInVan.length > 0 && filter === null;

  const tiles: { group: Group; icon: string; color: string; count: number; label: string }[] = [
    { group: "van", icon: "van-utility", color: palette.kitVan, count: kit.van.length, label: t("kit.tile_van") },
    { group: "home", icon: "home-outline", color: palette.kitHome, count: kit.home.length, label: t("kit.tile_home") },
    {
      group: "missing",
      icon: "cart-outline",
      color: palette.onSurfaceVariant,
      count: kit.missing.length,
      label: t("kit.tile_missing"),
    },
  ];

  const sectionHeader = (title: string, right?: React.ReactNode) => (
    <View style={styles.sectionHeader}>
      <Text variant="labelLarge" style={[styles.sectionTitle, { color: palette.onSurfaceVariant }]}>
        {title}
      </Text>
      {right}
    </View>
  );

  const groupEmpty = (
    <Text variant="bodyMedium" style={[styles.groupEmpty, { color: palette.onSurfaceVariant }]}>
      {t("kit.group_empty")}
    </Text>
  );

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <ScrollView
        ref={scrollRef}
        // Room under the last row so the switch button never hides it.
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 + (showSeasonSwitch ? 72 : 0) }}
      >
        <View style={styles.top}>
          <SegmentedButtons
            value={season}
            onValueChange={handleSeasonChange}
            buttons={[
              { value: "winter", icon: "snowflake", label: t("season.winter") },
              { value: "summer", icon: "weather-sunny", label: t("season.summer") },
            ]}
          />

          {data && total > 0 && (
            <View style={[styles.card, { backgroundColor: palette.surface }]}>
              <Text variant="titleMedium">{t("kit.summary", { owned, count: total })}</Text>
              <View
                style={[styles.bar, { backgroundColor: palette.surfaceVariant }]}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <View style={{ flex: kit.van.length, backgroundColor: palette.kitVan }} />
                <View style={{ flex: kit.home.length, backgroundColor: palette.kitHome }} />
                <View style={{ flex: kit.missing.length }} />
              </View>
              <View style={styles.tiles}>
                {tiles.map((tile) => {
                  const selected = filter === tile.group;
                  return (
                    <Pressable
                      key={tile.group}
                      onPress={() => toggleFilter(tile.group)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`${tile.count} ${tile.label}. ${t("kit.filter_a11y", { group: tile.label })}`}
                      style={[
                        styles.tile,
                        {
                          borderColor: selected ? tile.color : palette.divider,
                          borderWidth: selected ? 2 : 1,
                          borderStyle: tile.group === "missing" && !selected ? "dashed" : "solid",
                          backgroundColor: selected ? palette.surfaceVariant : palette.surface,
                        },
                      ]}
                    >
                      <Icon source={tile.icon} size={22} color={tile.color} />
                      <Text variant="headlineSmall" style={styles.tileCount}>
                        {tile.count}
                      </Text>
                      <Text variant="bodySmall" numberOfLines={2}>
                        {tile.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          {showBanner && (
            <View style={[styles.banner, { backgroundColor: palette.warningSurface }]}>
              <View style={styles.bannerRow}>
                <Icon
                  source={oppositeSeason === "summer" ? "weather-sunny" : "snowflake"}
                  size={22}
                  color={palette.warningOn}
                />
                <Text variant="bodyMedium" style={styles.bannerText}>
                  {t(`kit.banner_${oppositeSeason}`, {
                    count: kit.oppositeInVan.length,
                    names: bannerNames,
                  })}
                </Text>
              </View>
              <Button
                compact
                textColor={palette.onSurface}
                style={styles.bannerAction}
                onPress={() => setChangeoverVisible(true)}
              >
                {t("kit.banner_action")}
              </Button>
            </View>
          )}

          {season !== seasonMode && (
            <Text variant="bodySmall" style={{ color: palette.onSurfaceVariant }}>
              {t(`kit.viewing_${season}`)}
            </Text>
          )}
        </View>

        {data && total === 0 ? (
          <View style={styles.empty}>
            <View style={[styles.emptyIcon, { backgroundColor: palette.surfaceVariant }]}>
              <Icon
                source={season === "winter" ? "snowflake" : "weather-sunny"}
                size={48}
                color={palette.kitVan}
              />
            </View>
            <Text variant="titleLarge" style={styles.emptyText}>
              {t(`kit.empty_title_${season}`)}
            </Text>
            <Text variant="bodyMedium" style={[styles.emptyText, { color: palette.onSurfaceVariant }]}>
              {t(`kit.empty_desc_${season}`)}
            </Text>
            <Button
              mode="contained"
              icon="plus"
              buttonColor={palette.kitAction}
              textColor={palette.onKitAction}
              style={styles.emptyButton}
              onPress={() => setWantedDialogItem(null)}
            >
              {t("kit.add_missing")}
            </Button>
            <Button mode="outlined" style={styles.emptyButton} onPress={() => router.push("/search")}>
              {t("kit.empty_search")}
            </Button>
          </View>
        ) : data ? (
          <>
            {shows("van") && (
              <>
                {sectionHeader(t("kit.section_van", { count: kit.van.length }))}
                {kit.van.length === 0 && filter === "van" && groupEmpty}
                {kit.van.map((item) => (
                  <View key={item.id} style={{ backgroundColor: palette.surface }}>
                    <List.Item
                      title={item.name}
                      description={placeOf(item)}
                      onPress={() => openItem(item)}
                      left={(props) => <List.Icon {...props} icon="check" color={palette.kitVan} />}
                      right={(props) => <List.Icon {...props} icon="chevron-right" />}
                    />
                    <Divider />
                  </View>
                ))}
              </>
            )}

            {shows("home") && (kit.home.length > 0 || filter === "home") && (
              <>
                {sectionHeader(
                  t("kit.section_home", { count: kit.home.length }),
                  kit.home.length > 1 ? (
                    <Button
                      compact
                      onPress={() => run(() => setItemsOutOfVan(kit.home.map((i) => i.id), false))}
                    >
                      {t("kit.load_all")}
                    </Button>
                  ) : undefined
                )}
                {kit.home.length === 0 && groupEmpty}
                {kit.home.map((item) => (
                  <View key={item.id} style={{ backgroundColor: palette.surface }}>
                    <List.Item
                      title={item.name}
                      description={t("kit.home_place", { place: placeOf(item) })}
                      onPress={() => openItem(item)}
                      left={(props) => (
                        <List.Icon {...props} icon="home-outline" color={palette.kitHome} />
                      )}
                      right={() => (
                        <Button
                          mode="outlined"
                          compact
                          icon={item.location_icon}
                          style={styles.rowButton}
                          onPress={() => run(() => setItemsOutOfVan([item.id], false))}
                        >
                          {t("kit.load")}
                        </Button>
                      )}
                    />
                    <Divider />
                  </View>
                ))}
              </>
            )}

            {shows("missing") && (
              <>
                {sectionHeader(t("kit.section_missing", { count: kit.missing.length }))}
                {kit.missing.map((item) => (
                  <View
                    key={item.id}
                    style={{ backgroundColor: palette.surface }}
                    onLayout={(e) => {
                      const y = e.nativeEvent.layout.y;
                      rowYRef.current.set(item.id, y);
                      if (pendingScrollIdRef.current !== item.id) return;
                      pendingScrollIdRef.current = null;
                      scrollToRow(y);
                    }}
                  >
                    <HighlightFlashRow
                      active={highlightedId === item.id}
                      color={palette.primary}
                      onDone={handleHighlightDone}
                    >
                      <List.Item
                        title={item.name}
                        titleStyle={{ color: palette.onSurfaceVariant }}
                        description={item.notes || undefined}
                        onPress={() => setWantedDialogItem(item)}
                        left={(props) => (
                          <View style={props.style}>
                            <View style={[styles.dashedDot, { borderColor: palette.onSurfaceVariant }]} />
                          </View>
                        )}
                        right={() => (
                          <Button
                            mode="contained"
                            compact
                            buttonColor={palette.kitAction}
                            textColor={palette.onKitAction}
                            style={styles.rowButton}
                            onPress={() => setFulfilling(item)}
                          >
                            {t("kit.have_it")}
                          </Button>
                        )}
                      />
                    </HighlightFlashRow>
                    <Divider />
                  </View>
                ))}
                <View style={{ backgroundColor: palette.surface }}>
                  <List.Item
                    title={t("kit.add_missing")}
                    titleStyle={{ color: palette.kitVan, fontWeight: "500" }}
                    onPress={() => setWantedDialogItem(null)}
                    left={(props) => <List.Icon {...props} icon="plus" color={palette.kitVan} />}
                  />
                </View>
              </>
            )}

            {filter === null && kit.allYear.length > 0 && (
              <>
                <Pressable
                  onPress={() => setAllYearOpen((o) => !o)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: allYearOpen }}
                  style={[
                    styles.allYearHeader,
                    { borderColor: palette.divider, backgroundColor: palette.surfaceVariant },
                  ]}
                >
                  <Text variant="bodyLarge" style={styles.allYearTitle}>
                    {t("kit.section_all_year", { count: kit.allYear.length })}
                  </Text>
                  <Icon source={allYearOpen ? "chevron-up" : "chevron-down"} size={22} />
                </Pressable>
                {allYearOpen &&
                  kit.allYear.map((item) => (
                    <View key={item.id} style={{ backgroundColor: palette.surface }}>
                      <List.Item
                        title={item.name}
                        description={placeOf(item)}
                        onPress={() => openItem(item)}
                        style={styles.allYearRow}
                      />
                      <Divider />
                    </View>
                  ))}
              </>
            )}
          </>
        ) : null}
      </ScrollView>

      {showSeasonSwitch && (
        <AnimatedFAB
          icon={calendarSeason === "summer" ? "weather-sunny" : "snowflake"}
          label={t(`kit.switch_${calendarSeason}`)}
          accessibilityLabel={t(`kit.switch_${calendarSeason}`)}
          extended={switchExtended}
          animateFrom="right"
          iconMode="static"
          color={palette.onKitAction}
          onPress={handleSeasonSwitch}
          style={[styles.seasonSwitch, { backgroundColor: palette.kitAction, bottom: insets.bottom + 16 }]}
        />
      )}

      <WantedItemDialog
        visible={wantedDialogItem !== undefined}
        item={wantedDialogItem ?? null}
        defaultSeason={season}
        onCancel={() => setWantedDialogItem(undefined)}
        onSave={handleSaveWanted}
        onDelete={handleDeleteWanted}
      />
      <FulfillWantedDialog
        item={fulfilling}
        locationId={isGlobalView ? null : scopeLocationId}
        onCancel={() => setFulfilling(null)}
        onConfirm={handleFulfill}
      />
      <SeasonChangeoverDialog
        visible={changeoverVisible}
        season={seasonMode}
        onDismiss={() => {
          setChangeoverVisible(false);
          load();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  top: { padding: 16, gap: 14 },
  card: { borderRadius: 16, padding: 16, gap: 12 },
  bar: { flexDirection: "row", height: 10, borderRadius: 5, overflow: "hidden", gap: 2 },
  tiles: { flexDirection: "row", gap: 8 },
  tile: { flex: 1, minHeight: 96, borderRadius: 14, padding: 10, gap: 2 },
  tileCount: { fontWeight: "700" },
  banner: { borderRadius: 12, padding: 12, gap: 4 },
  bannerRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  bannerText: { flex: 1 },
  bannerAction: { alignSelf: "flex-end" },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: 16,
    paddingRight: 8,
    paddingTop: 16,
    paddingBottom: 4,
    minHeight: 44,
  },
  sectionTitle: { flex: 1 },
  groupEmpty: { paddingHorizontal: 16, paddingVertical: 12 },
  rowButton: { alignSelf: "center" },
  dashedDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderStyle: "dashed",
    marginHorizontal: 3,
    marginTop: 3,
  },
  allYearHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 16,
    marginTop: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  allYearTitle: { flex: 1 },
  allYearRow: { paddingLeft: 40 },
  empty: { alignItems: "center", paddingHorizontal: 32, paddingTop: 32, gap: 14 },
  emptyIcon: { width: 96, height: 96, borderRadius: 48, alignItems: "center", justifyContent: "center" },
  emptyText: { textAlign: "center" },
  emptyButton: { alignSelf: "stretch" },
  seasonSwitch: { position: "absolute", right: 16 },
});
