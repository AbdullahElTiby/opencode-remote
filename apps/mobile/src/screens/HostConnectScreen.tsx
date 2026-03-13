import { useMemo, useState, type ReactNode } from "react"
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera"
import { SafeAreaView } from "react-native-safe-area-context"
import type { AuthTokens } from "@opencode-remote/shared"
import { BrandLockup } from "../components/BrandLockup"
import { buttonSurface, cardSurface, inputSurface } from "../design/primitives"
import { useAppTheme } from "../design/theme"
import { spacing, typography, type ThemeColors } from "../design/tokens"
import { buildPairingDeviceMetadata } from "../lib/device-metadata"
import { pairDevice, startPairingChallenge } from "../lib/api"

type Props = {
  onPaired: (serverUrl: string, tokens: AuthTokens) => Promise<void>
}

export function HostConnectScreen({ onPaired }: Props) {
  const theme = useAppTheme()
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors])
  const [serverUrl, setServerUrl] = useState("http://localhost:8787")
  const [challengeId, setChallengeId] = useState("")
  const [code, setCode] = useState("")
  const [deviceName, setDeviceName] = useState("My phone")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scannerVisible, setScannerVisible] = useState(false)
  const [scanLocked, setScanLocked] = useState(false)
  const [cameraPermission, requestCameraPermission] = useCameraPermissions()

  const disabled = useMemo(
    () => busy || !serverUrl.trim() || !challengeId.trim() || !code.trim() || !deviceName.trim(),
    [busy, challengeId, code, deviceName, serverUrl],
  )

  async function handlePair() {
    setBusy(true)
    setError(null)
    try {
      const tokens = await pairDevice(serverUrl, {
        challengeId,
        code,
        deviceName,
        ...buildPairingDeviceMetadata(),
      })
      await onPaired(serverUrl, tokens)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Pairing failed")
    } finally {
      setBusy(false)
    }
  }

  async function handleCreateChallenge() {
    setBusy(true)
    setError(null)
    try {
      const pairing = await startPairingChallenge(serverUrl)
      setChallengeId(pairing.challengeId)
      setCode(pairing.code)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not create pairing challenge")
    } finally {
      setBusy(false)
    }
  }

  async function handleOpenScanner() {
    setError(null)

    if (!cameraPermission?.granted) {
      const response = await requestCameraPermission()
      if (!response.granted) {
        setError("Camera permission is required to scan a pairing QR code.")
        return
      }
    }

    setScanLocked(false)
    setScannerVisible(true)
  }

  function applyPairingPayload(rawValue: string) {
    try {
      const payload = JSON.parse(rawValue) as {
        serverUrl?: string
        challengeId?: string
        code?: string
      }

      if (!payload.serverUrl || !payload.challengeId || !payload.code) {
        throw new Error("Missing fields")
      }

      setServerUrl(payload.serverUrl)
      setChallengeId(payload.challengeId)
      setCode(payload.code)
      setError(null)
      setScannerVisible(false)
    } catch {
      setError("Scanned QR code is not a valid OpenCode Remote pairing code.")
      setScannerVisible(false)
    }
  }

  function handleBarcodeScanned(result: BarcodeScanningResult) {
    if (scanLocked) return
    setScanLocked(true)
    applyPairingPayload(result.data)
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <BrandLockup caption="OpenCode companion for remote session control." />
          <Text style={styles.heroTitle}>Connect your phone to your OpenCode host.</Text>
          <Text style={styles.heroBody}>
            Pair over your trusted network first, then use the mobile app as a compact OpenCode control surface for
            sessions, approvals, slash commands, and terminal attach.
          </Text>
          <View style={styles.heroActions}>
            <Pressable
              style={[styles.primaryHeroButton, busy && styles.buttonDisabled]}
              disabled={busy}
              onPress={handleOpenScanner}
            >
              <Text style={styles.primaryHeroButtonText}>Scan pairing QR</Text>
            </Pressable>
            <Pressable
              style={[styles.secondaryHeroButton, busy && styles.buttonDisabled]}
              disabled={busy}
              onPress={handleCreateChallenge}
            >
              <Text style={styles.secondaryHeroButtonText}>Create challenge here</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionKicker}>PAIRING</Text>
          <Text style={styles.sectionTitle}>Manual connection</Text>
          <Text style={styles.sectionBody}>
            Use the QR flow when possible. Manual entry stays available for desktop pairing pages, copied values, and
            direct host testing on the same network.
          </Text>

          <Field label="Gateway URL" styles={styles}>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              value={serverUrl}
              onChangeText={setServerUrl}
              placeholder="http://192.168.x.x:8787"
              placeholderTextColor={theme.colors.textDim}
            />
          </Field>

          <View style={styles.fieldRow}>
            <Field label="Challenge ID" style={styles.fieldSplit} styles={styles}>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
                value={challengeId}
                onChangeText={setChallengeId}
                placeholder="Challenge"
                placeholderTextColor={theme.colors.textDim}
              />
            </Field>

            <Field label="Code" style={styles.fieldCode} styles={styles}>
              <TextInput
                keyboardType="number-pad"
                style={styles.input}
                value={code}
                onChangeText={setCode}
                placeholder="000000"
                placeholderTextColor={theme.colors.textDim}
              />
            </Field>
          </View>

          <Field label="Device name" styles={styles}>
            <TextInput
              style={styles.input}
              value={deviceName}
              onChangeText={setDeviceName}
              placeholder="My phone"
              placeholderTextColor={theme.colors.textDim}
            />
          </Field>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={[styles.primaryAction, disabled && styles.buttonDisabled]}
            disabled={disabled}
            onPress={handlePair}
          >
            {busy ? (
              <ActivityIndicator color={theme.colors.textOnAccent} />
            ) : (
              <Text style={styles.primaryActionText}>Pair device</Text>
            )}
          </Pressable>

          <Text style={styles.footerNote}>
            OpenCode Remote is an independent companion app for OpenCode and is not affiliated with or endorsed by the
            OpenCode maintainers.
          </Text>
        </View>
      </ScrollView>

      <Modal animationType="slide" transparent visible={scannerVisible} onRequestClose={() => setScannerVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <BrandLockup compact caption="Scan the QR shown on your host pairing page." />
            <View style={styles.cameraFrame}>
              <CameraView
                style={styles.camera}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={scanLocked ? undefined : handleBarcodeScanned}
              />
            </View>
            <Pressable
              style={styles.secondaryHeroButton}
              onPress={() => {
                setScannerVisible(false)
                setScanLocked(false)
              }}
            >
              <Text style={styles.secondaryHeroButtonText}>Close scanner</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

type FieldProps = {
  label: string
  style?: object
  children: ReactNode
  styles: ReturnType<typeof createStyles>
}

function Field({ label, style, children, styles }: FieldProps) {
  return (
    <View style={style}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  )
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.app,
    },
    container: {
      flexGrow: 1,
      backgroundColor: colors.app,
      padding: spacing.lg,
      gap: spacing.lg,
      justifyContent: "center",
    },
    hero: {
      ...cardSurface(colors),
      padding: spacing.xl,
      gap: spacing.md,
    },
    heroTitle: {
      color: colors.text,
      fontSize: 30,
      lineHeight: 36,
      fontWeight: "700",
    },
    heroBody: {
      color: colors.textMuted,
      lineHeight: 22,
    },
    heroActions: {
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    primaryHeroButton: {
      ...buttonSurface(colors, "accent"),
      minHeight: 52,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing.lg,
    },
    primaryHeroButtonText: {
      color: colors.textOnAccent,
      fontWeight: "800",
      fontSize: 15,
    },
    secondaryHeroButton: {
      ...buttonSurface(colors, "panelStrong"),
      minHeight: 48,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing.lg,
    },
    secondaryHeroButtonText: {
      color: colors.text,
      fontWeight: "700",
      fontSize: 14,
    },
    section: {
      ...cardSurface(colors, "surfaceMuted"),
      padding: spacing.xl,
      gap: spacing.md,
    },
    sectionKicker: {
      color: colors.textDim,
      fontSize: 11,
      letterSpacing: 1.2,
      fontFamily: typography.mono,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 20,
      fontWeight: "700",
    },
    sectionBody: {
      color: colors.textMuted,
      lineHeight: 22,
    },
    label: {
      color: colors.textDim,
      fontFamily: typography.mono,
      fontSize: 12,
      marginBottom: spacing.xs,
    },
    fieldRow: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    fieldSplit: {
      flex: 1,
    },
    fieldCode: {
      width: 110,
    },
    input: {
      minHeight: 52,
      ...inputSurface(colors, "panel"),
      color: colors.text,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
    },
    primaryAction: {
      ...buttonSurface(colors, "accent"),
      marginTop: spacing.sm,
      minHeight: 54,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing.lg,
    },
    primaryActionText: {
      color: colors.textOnAccent,
      fontWeight: "800",
      fontSize: 15,
    },
    footerNote: {
      color: colors.textDim,
      fontSize: 12,
      lineHeight: 18,
    },
    error: {
      color: colors.danger,
      lineHeight: 20,
    },
    buttonDisabled: {
      opacity: 0.55,
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: "center",
      padding: spacing.lg,
    },
    modalCard: {
      ...cardSurface(colors),
      padding: spacing.lg,
      gap: spacing.md,
    },
    cameraFrame: {
      overflow: "hidden",
      ...cardSurface(colors, "surfaceMuted"),
      backgroundColor: colors.canvas,
      aspectRatio: 1,
    },
    camera: {
      flex: 1,
    },
  })
}
