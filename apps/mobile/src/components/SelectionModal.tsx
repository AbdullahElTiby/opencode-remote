import { useMemo, useState } from "react"
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { buttonSurface, cardSurface, inputSurface } from "../design/primitives"
import { useAppTheme } from "../design/theme"
import { spacing, typography, type ThemeColors } from "../design/tokens"

type Item = {
  id: string
  title: string
  subtitle?: string | null
}

type Props = {
  visible: boolean
  title: string
  searchPlaceholder?: string
  searchable?: boolean
  items: Item[]
  selectedId: string | null
  onSelect: (id: string) => void
  onClose: () => void
}

export function SelectionModal({
  visible,
  title,
  searchPlaceholder = "Search",
  searchable = true,
  items,
  selectedId,
  onSelect,
  onClose,
}: Props) {
  const theme = useAppTheme()
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors])
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return items
    return items.filter((item) => {
      const haystack = `${item.title} ${item.subtitle ?? ""}`.toLowerCase()
      return haystack.includes(normalized)
    })
  }, [items, query])

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.kicker}>SELECT</Text>
          <Text style={styles.title}>{title}</Text>
          {searchable ? (
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={searchPlaceholder}
              placeholderTextColor={theme.colors.textDim}
              style={styles.search}
            />
          ) : null}
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {filtered.map((item) => (
              <Pressable
                key={item.id}
                style={[styles.option, selectedId === item.id && styles.optionSelected]}
                onPress={() => {
                  onSelect(item.id)
                  onClose()
                }}
              >
                <Text style={styles.optionTitle}>{item.title}</Text>
                {item.subtitle ? <Text style={styles.optionSubtitle}>{item.subtitle}</Text> : null}
              </Pressable>
            ))}
            {!filtered.length ? <Text style={styles.empty}>No matches.</Text> : null}
          </ScrollView>
          <Pressable style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      justifyContent: "center",
      backgroundColor: colors.overlay,
      padding: spacing.lg,
    },
    card: {
      maxHeight: "80%",
      ...cardSurface(colors),
      padding: spacing.lg,
      gap: spacing.sm,
    },
    kicker: {
      color: colors.textDim,
      fontSize: 11,
      letterSpacing: 1.2,
      fontFamily: typography.mono,
    },
    title: {
      color: colors.text,
      fontSize: 22,
      fontWeight: "700",
    },
    search: {
      ...inputSurface(colors, "panel"),
      color: colors.text,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
    },
    list: {
      minHeight: 140,
    },
    listContent: {
      gap: spacing.sm,
    },
    option: {
      ...cardSurface(colors, "surfaceMuted"),
      padding: spacing.md,
      gap: 4,
    },
    optionSelected: {
      borderColor: colors.borderStrong,
      backgroundColor: colors.panelStrong,
    },
    optionTitle: {
      color: colors.text,
      fontWeight: "700",
    },
    optionSubtitle: {
      color: colors.textDim,
      fontSize: 12,
      fontFamily: typography.mono,
    },
    empty: {
      color: colors.textDim,
      textAlign: "center",
      paddingVertical: 24,
    },
    closeButton: {
      ...buttonSurface(colors, "panelStrong"),
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 14,
    },
    closeText: {
      color: colors.text,
      fontWeight: "700",
    },
  })
}
