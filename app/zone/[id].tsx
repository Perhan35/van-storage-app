import React, { useEffect, useState, useCallback } from "react";
import { View, FlatList, StyleSheet, Alert, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter, useNavigation } from "expo-router";
import {
  Text,
  TextInput,
  IconButton,
  List,
  Divider,
  Button,
  Dialog,
  Portal,
  Menu,
} from "react-native-paper";
import { useAppStore } from "../../src/store/useAppStore";
import { Item } from "../../src/db/database";

export default function ZoneDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const zones = useAppStore((s) => s.zones);
  const getItemsForZone = useAppStore((s) => s.getItemsForZone);
  const addItem = useAppStore((s) => s.addItem);
  const deleteItem = useAppStore((s) => s.deleteItem);
  const updateItem = useAppStore((s) => s.updateItem);
  const moveItem = useAppStore((s) => s.moveItem);
  const updateZone = useAppStore((s) => s.updateZone);
  const deleteZone = useAppStore((s) => s.deleteZone);
  const splitZone = useAppStore((s) => s.splitZone);

  const [items, setItems] = useState<Item[]>([]);
  const [newItemName, setNewItemName] = useState("");
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [editName, setEditName] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [menuVisible, setMenuVisible] = useState<string | null>(null);
  const [movingItem, setMovingItem] = useState<Item | null>(null);
  const [zoneEditVisible, setZoneEditVisible] = useState(false);
  const [zoneName, setZoneName] = useState("");
  const [zoneColor, setZoneColor] = useState("");

  const zone = zones.find((z) => z.id === id);

  const loadItems = useCallback(async () => {
    if (id) {
      const data = await getItemsForZone(id);
      setItems(data);
    }
  }, [id, getItemsForZone]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (zone) {
      navigation.setOptions({ title: zone.name });
      setZoneName(zone.name);
      setZoneColor(zone.color);
    }
  }, [zone, navigation]);

  const handleAddItem = async () => {
    const trimmed = newItemName.trim();
    if (!trimmed || !id) return;
    await addItem(trimmed, id);
    setNewItemName("");
    await loadItems();
  };

  const handleDeleteItem = (item: Item) => {
    setMenuVisible(null);
    Alert.alert("Supprimer", `Supprimer "${item.name}" ?`, [
      { text: "Annuler", style: "cancel" },
      {
        text: "Supprimer",
        style: "destructive",
        onPress: async () => {
          await deleteItem(item.id);
          await loadItems();
        },
      },
    ]);
  };

  const handleSaveEdit = async () => {
    if (!editingItem) return;
    await updateItem(editingItem.id, editName.trim(), editNotes.trim());
    setEditingItem(null);
    await loadItems();
  };

  const handleMoveItem = async (itemId: string, newZoneId: string) => {
    await moveItem(itemId, newZoneId);
    setMovingItem(null);
    await loadItems();
  };

  const handleSaveZone = async () => {
    if (!id) return;
    await updateZone(id, zoneName.trim(), zoneColor.trim());
    setZoneEditVisible(false);
  };

  const handleDeleteZone = () => {
    Alert.alert(
      "Supprimer la zone",
      "Tous les objets de cette zone seront supprimés. Continuer ?",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Supprimer",
          style: "destructive",
          onPress: async () => {
            if (id) {
              await deleteZone(id);
              router.back();
            }
          },
        },
      ]
    );
  };

  const handleSplitZone = () => {
    if (!zone) return;
    const { w, h } = zone.geometry;
    const direction = w >= h ? "gauche / droite" : "haut / bas";
    Alert.alert(
      "Splitter la zone",
      `Diviser "${zone.name}" en deux (${direction}) ?\n\nLes objets existants seront déplacés dans la première zone.`,
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Splitter",
          onPress: async () => {
            if (id) {
              const newZoneId = await splitZone(id);
              if (newZoneId) {
                router.replace(`/zone/${newZoneId}`);
              }
            }
          },
        },
      ]
    );
  };

  if (!zone) {
    return (
      <View style={styles.center}>
        <Text>Zone introuvable</Text>
      </View>
    );
  }

  const otherZones = zones.filter((z) => z.id !== id);

  return (
    <View style={styles.container}>
      {/* Zone header */}
      <View style={[styles.header, { backgroundColor: zone.color + "33" }]}>
        <View style={styles.headerRow}>
          <View style={[styles.colorDot, { backgroundColor: zone.color }]} />
          <Text variant="titleMedium" style={styles.headerTitle}>
            {zone.name}
          </Text>
          <IconButton
            icon="call-split"
            size={20}
            onPress={handleSplitZone}
          />
          <IconButton
            icon="pencil"
            size={20}
            onPress={() => setZoneEditVisible(true)}
          />
        </View>
        <Text variant="bodySmall" style={styles.itemCount}>
          {items.length} objet{items.length !== 1 ? "s" : ""}
        </Text>
      </View>

      {/* Add item */}
      <View style={styles.addRow}>
        <TextInput
          mode="outlined"
          placeholder="Ajouter un objet..."
          value={newItemName}
          onChangeText={setNewItemName}
          onSubmitEditing={handleAddItem}
          style={styles.addInput}
          dense
        />
        <IconButton
          icon="plus-circle"
          size={32}
          iconColor="#4A90D9"
          onPress={handleAddItem}
        />
      </View>

      {/* Items list */}
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <List.Item
            title={item.name}
            description={item.notes || undefined}
            onPress={() => {
              setEditingItem(item);
              setEditName(item.name);
              setEditNotes(item.notes);
            }}
            right={() => (
              <Menu
                visible={menuVisible === item.id}
                onDismiss={() => setMenuVisible(null)}
                anchor={
                  <IconButton
                    icon="dots-vertical"
                    size={24}
                    onPress={() => setMenuVisible(item.id)}
                  />
                }
              >
                <Menu.Item
                  leadingIcon="pencil-outline"
                  title="Modifier"
                  onPress={() => {
                    setMenuVisible(null);
                    setEditingItem(item);
                    setEditName(item.name);
                    setEditNotes(item.notes);
                  }}
                />
                {otherZones.length > 0 && (
                  <Menu.Item
                    leadingIcon="arrow-right-bold"
                    title="Déplacer"
                    onPress={() => {
                      setMenuVisible(null);
                      setMovingItem(item);
                    }}
                  />
                )}
                <Divider />
                <Menu.Item
                  leadingIcon="delete-outline"
                  title="Supprimer"
                  titleStyle={styles.deleteText}
                  onPress={() => handleDeleteItem(item)}
                />
              </Menu>
            )}
          />
        )}
        ItemSeparatorComponent={Divider}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text variant="bodyMedium" style={styles.emptyText}>
              Aucun objet dans cette zone
            </Text>
          </View>
        }
      />

      <Portal>
        {/* Edit item dialog */}
        <Dialog
          visible={!!editingItem}
          onDismiss={() => setEditingItem(null)}
        >
          <Dialog.Title>Modifier l'objet</Dialog.Title>
          <Dialog.Content>
            <TextInput
              mode="outlined"
              label="Nom"
              value={editName}
              onChangeText={setEditName}
              style={styles.dialogInput}
            />
            <TextInput
              mode="outlined"
              label="Notes (optionnel)"
              value={editNotes}
              onChangeText={setEditNotes}
              multiline
              style={styles.dialogInput}
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setEditingItem(null)}>Annuler</Button>
            <Button onPress={handleSaveEdit}>Enregistrer</Button>
          </Dialog.Actions>
        </Dialog>

        {/* Move item dialog */}
        <Dialog
          visible={!!movingItem}
          onDismiss={() => setMovingItem(null)}
        >
          <Dialog.Title>Déplacer vers...</Dialog.Title>
          <Dialog.ScrollArea style={styles.scrollArea}>
            <ScrollView>
              {otherZones.map((z) => (
                <List.Item
                  key={z.id}
                  title={z.name}
                  left={() => (
                    <View
                      style={[
                        styles.zoneColorDot,
                        { backgroundColor: z.color },
                      ]}
                    />
                  )}
                  onPress={() => {
                    if (movingItem) handleMoveItem(movingItem.id, z.id);
                  }}
                />
              ))}
            </ScrollView>
          </Dialog.ScrollArea>
        </Dialog>

        {/* Edit zone dialog */}
        <Dialog
          visible={zoneEditVisible}
          onDismiss={() => setZoneEditVisible(false)}
        >
          <Dialog.Title>Modifier la zone</Dialog.Title>
          <Dialog.Content>
            <TextInput
              mode="outlined"
              label="Nom de la zone"
              value={zoneName}
              onChangeText={setZoneName}
              style={styles.dialogInput}
            />
            <TextInput
              mode="outlined"
              label="Couleur (hex)"
              value={zoneColor}
              onChangeText={setZoneColor}
              style={styles.dialogInput}
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button textColor="#D32F2F" onPress={handleDeleteZone}>
              Supprimer
            </Button>
            <Button onPress={() => setZoneEditVisible(false)}>Annuler</Button>
            <Button onPress={handleSaveZone}>Enregistrer</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  header: { padding: 16 },
  headerRow: { flexDirection: "row", alignItems: "center" },
  colorDot: { width: 16, height: 16, borderRadius: 8, marginRight: 8 },
  headerTitle: { flex: 1 },
  itemCount: { color: "#757575", marginTop: 4 },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  addInput: { flex: 1 },
  deleteText: { color: "#D32F2F" },
  emptyText: { color: "#9E9E9E" },
  dialogInput: { marginBottom: 12 },
  scrollArea: { maxHeight: 400 },
  zoneColorDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginLeft: 8,
    alignSelf: "center",
  },
});
