import { useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useNavigation } from "@react-navigation/native"
import { WebView } from "react-native-webview"
import type { StreamEvent, TerminalInput } from "@opencode-remote/shared"
import { AppHeader } from "../components/AppHeader"
import { buttonSurface, cardSurface, inputSurface, tagSurface } from "../design/primitives"
import { useAppTheme } from "../design/theme"
import { sessionStatusTone, spacing, typography, type ThemeColors } from "../design/tokens"
import { openTerminalSocket } from "../lib/api"
import { terminalHtml } from "../lib/terminal-html"
import type { AuthSession } from "../state/auth-store"

type Props = {
  auth: AuthSession
  sessionId: string
}

type WebEvent = {
  type?: string
  cols?: number
  rows?: number
  data?: string
}

export function TerminalScreen({ auth, sessionId }: Props) {
  const theme = useAppTheme()
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors])
  const html = useMemo(() => terminalHtml(theme.colors), [theme.colors])
  const navigation = useNavigation()
  const web = useRef<WebView>(null)
  const socket = useRef<WebSocket | null>(null)
  const [input, setInput] = useState("")
  const [connected, setConnected] = useState(false)
  const [ready, setReady] = useState(false)
  const [closed, setClosed] = useState(false)

  const size = useMemo(() => {
    const view = Dimensions.get("window")
    return {
      cols: Math.max(80, Math.floor(view.width / 8)),
      rows: Math.max(24, Math.floor((view.height - 220) / 18)),
    }
  }, [])

  const statusTone = sessionStatusTone(theme.colors, connected ? "busy" : closed ? "retry" : "idle")

  const send = (payload: TerminalInput) => {
    socket.current?.send(JSON.stringify(payload))
  }

  const fit = () => {
    web.current?.injectJavaScript("window.__fit?.(); true;")
  }

  const connect = useMemo(
    () => () => {
      socket.current?.close()
      setConnected(false)
      setClosed(false)
      socket.current = openTerminalSocket(auth, sessionId, {
        onMessage(event: StreamEvent) {
          if (event.kind === "terminal.frame") {
            const data = JSON.stringify(event.payload.data)
            web.current?.injectJavaScript(`window.__append(${data}); true;`)
          }
          if (event.kind === "terminal.exit") {
            web.current?.injectJavaScript('window.__append("\\r\\n[session exited]\\r\\n"); true;')
          }
        },
        onClose() {
          setConnected(false)
          setClosed(true)
        },
      })
      socket.current.onopen = () => {
        setConnected(true)
        setClosed(false)
        send({ type: "resize", ...size })
        fit()
      }
    },
    [auth, sessionId, size],
  )

  useEffect(() => {
    connect()
    return () => {
      socket.current?.close()
    }
  }, [connect])

  useEffect(() => {
    const sub = Dimensions.addEventListener("change", fit)
    return () => {
      sub.remove()
    }
  }, [])

  const onWeb = (value: string) => {
    const event = JSON.parse(value) as WebEvent
    if (event.type === "ready") {
      setReady(true)
      send({ type: "resize", ...size })
      fit()
      return
    }
    if (event.type === "resize" && event.cols && event.rows) {
      send({ type: "resize", cols: event.cols, rows: event.rows })
      return
    }
    if (event.type === "input" && event.data) {
      send({ type: "input", data: event.data })
    }
  }

  function sendTypedText(suffix = "") {
    if (!input && !suffix) return
    send({
      type: "input",
      data: `${input}${suffix}`,
    })
    setInput("")
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <AppHeader
          title="Terminal"
          subtitle="Live attach for OpenCode TUI sessions."
          onBack={() => navigation.goBack()}
          right={
            <View
              style={[
                styles.statusBadge,
                { backgroundColor: statusTone.backgroundColor, borderColor: statusTone.borderColor },
              ]}
            >
              <Text style={[styles.statusBadgeText, { color: statusTone.textColor }]}>
                {connected ? "live" : closed ? "disconnected" : "connecting"}
              </Text>
            </View>
          }
        />

        <View style={styles.infoStrip}>
          <Text style={styles.infoLabel}>SESSION</Text>
          <Text style={styles.infoValue} numberOfLines={1}>
            {sessionId}
          </Text>
          <Pressable style={styles.infoAction} onPress={connect}>
            <Text style={styles.infoActionText}>{connected ? "Refresh" : "Reconnect"}</Text>
          </Pressable>
        </View>

        <View style={styles.terminalShell}>
          <WebView
            originWhitelist={["*"]}
            ref={web}
            source={{ html }}
            style={styles.webview}
            onMessage={(event) => onWeb(event.nativeEvent.data)}
            onLoadEnd={fit}
          />
          {!ready ? (
            <View style={styles.overlay}>
              <ActivityIndicator color={theme.colors.text} />
              <Text style={styles.overlayText}>Preparing terminal surface...</Text>
            </View>
          ) : null}
        </View>

        {closed ? (
          <Text style={styles.inlineNotice}>
            This session does not currently expose a live attach stream, or the host attach process exited.
          </Text>
        ) : null}

        <View style={styles.toolbar}>
          <Tool label="Ctrl+C" onPress={() => send({ type: "interrupt" })} />
          <Tool label="Tab" onPress={() => send({ type: "input", data: "\t" })} />
          <Tool label="Esc" onPress={() => send({ type: "input", data: "\u001b" })} />
          <Tool label="Clear" onPress={() => web.current?.injectJavaScript("window.__clear(); true;")} />
          <Tool label="Detach" onPress={() => send({ type: "detach" })} tone="danger" />
        </View>

        <View style={styles.composer}>
          <TextInput
            multiline
            value={input}
            onChangeText={setInput}
            placeholder='Terminal input...  "npm test"'
            placeholderTextColor={theme.colors.textDim}
            style={styles.input}
          />
          <View style={styles.composerActions}>
            <Pressable style={styles.secondaryButton} onPress={() => sendTypedText()}>
              <Text style={styles.secondaryText}>Send</Text>
            </Pressable>
            <Pressable style={styles.primaryButton} onPress={() => sendTypedText("\r")}>
              <Text style={styles.primaryText}>Enter</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </SafeAreaView>
  )
}

function Tool({ label, onPress, tone = "default" }: { label: string; onPress: () => void; tone?: "default" | "danger" }) {
  const theme = useAppTheme()
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors])

  return (
    <Pressable style={[styles.toolButton, tone === "danger" && styles.toolButtonDanger]} onPress={onPress}>
      <Text style={[styles.toolText, tone === "danger" && styles.toolTextDanger]}>{label}</Text>
    </Pressable>
  )
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.app,
    },
    container: {
      flex: 1,
      backgroundColor: colors.app,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.lg,
      gap: spacing.md,
    },
    statusBadge: {
      ...tagSurface(colors, "panelStrong"),
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
    },
    statusBadgeText: {
      fontSize: 11,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.8,
      fontFamily: typography.mono,
    },
    infoStrip: {
      ...cardSurface(colors),
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    infoLabel: {
      color: colors.textDim,
      fontSize: 11,
      letterSpacing: 1.2,
      fontFamily: typography.mono,
    },
    infoValue: {
      flex: 1,
      color: colors.textMuted,
      fontSize: 12,
      fontFamily: typography.mono,
    },
    infoAction: {
      ...buttonSurface(colors, "panelStrong"),
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
    },
    infoActionText: {
      color: colors.text,
      fontSize: 12,
      fontWeight: "700",
    },
    terminalShell: {
      ...cardSurface(colors, "surfaceMuted"),
      flex: 1,
      minHeight: 0,
      overflow: "hidden",
      backgroundColor: colors.canvas,
    },
    webview: {
      flex: 1,
      backgroundColor: colors.canvas,
    },
    overlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      backgroundColor: colors.overlay,
    },
    overlayText: {
      color: colors.textMuted,
      fontFamily: typography.mono,
    },
    inlineNotice: {
      color: colors.textDim,
      fontSize: 12,
      lineHeight: 18,
      fontFamily: typography.mono,
    },
    toolbar: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    toolButton: {
      ...buttonSurface(colors, "surface"),
      minHeight: 38,
      paddingHorizontal: spacing.md,
      alignItems: "center",
      justifyContent: "center",
    },
    toolButtonDanger: {
      ...buttonSurface(colors, "danger"),
    },
    toolText: {
      color: colors.text,
      fontSize: 13,
      fontWeight: "700",
      fontFamily: typography.mono,
    },
    toolTextDanger: {
      color: colors.danger,
    },
    composer: {
      ...cardSurface(colors),
      padding: spacing.md,
      gap: spacing.sm,
    },
    input: {
      minHeight: 76,
      ...inputSurface(colors, "panel"),
      color: colors.text,
      padding: spacing.md,
      textAlignVertical: "top",
    },
    composerActions: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    secondaryButton: {
      ...buttonSurface(colors, "panelStrong"),
      flex: 1,
      minHeight: 48,
      alignItems: "center",
      justifyContent: "center",
    },
    secondaryText: {
      color: colors.text,
      fontWeight: "700",
    },
    primaryButton: {
      ...buttonSurface(colors, "accent"),
      flex: 1,
      minHeight: 48,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryText: {
      color: colors.textOnAccent,
      fontWeight: "800",
    },
  })
}
