import type { ThemeColors } from "../design/tokens"

export function terminalHtml(colors: ThemeColors) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm/css/xterm.css" />
    <style>
      html, body, #terminal { margin: 0; padding: 0; width: 100%; height: 100%; background: ${colors.canvas}; }
    </style>
  </head>
  <body>
    <div id="terminal"></div>
    <script src="https://cdn.jsdelivr.net/npm/xterm/lib/xterm.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/xterm-addon-fit/lib/xterm-addon-fit.js"></script>
    <script>
      const term = new Terminal({
        fontFamily: "Menlo, ui-monospace, monospace",
        fontSize: 13,
        cursorBlink: true,
        convertEol: true,
        theme: {
          background: "${colors.canvas}",
          foreground: "${colors.text}",
          cursor: "${colors.accent}",
          selectionBackground: "${colors.panelStrong}",
          black: "${colors.canvas}",
          red: "${colors.danger}",
          green: "${colors.success}",
          yellow: "${colors.warning}",
          blue: "${colors.info}",
          magenta: "${colors.accentMuted}",
          cyan: "${colors.accentSoft}",
          white: "${colors.text}",
          brightBlack: "${colors.textDim}",
          brightWhite: "${colors.text}"
        }
      });
      const fit = new FitAddon.FitAddon();
      term.loadAddon(fit);
      term.open(document.getElementById("terminal"));
      term.focus();
      term.write("Connecting to OpenCode TUI...\\r\\n");

      function post(message) {
        window.ReactNativeWebView?.postMessage(JSON.stringify(message));
      }

      function sync() {
        fit.fit();
        post({ type: "resize", cols: term.cols, rows: term.rows });
      }

      term.onData(function (data) {
        post({ type: "input", data: data });
      });

      window.addEventListener("resize", sync);
      window.__append = function (chunk) {
        term.write(chunk);
      };
      window.__clear = function () {
        term.clear();
      };
      window.__fit = sync;
      sync();
      post({ type: "ready" });
    </script>
  </body>
</html>`
}
