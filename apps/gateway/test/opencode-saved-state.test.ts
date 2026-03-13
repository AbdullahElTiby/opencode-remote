import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import {
  DesktopSavedStateReader,
  emptySavedOpenCodeStateSnapshot,
} from "../src/opencode-saved-state.js"

const tempDir = path.join(os.tmpdir(), `opencode-saved-state-test-${Date.now()}`)

afterAll(async () => {
  await fs.rm(tempDir, { recursive: true, force: true })
})

describe("DesktopSavedStateReader", () => {
  it("returns an empty snapshot when no desktop state exists", async () => {
    const reader = new DesktopSavedStateReader({
      appDataDirectory: path.join(tempDir, "missing"),
      ttlMs: 0,
    })

    await expect(reader.readSnapshot()).resolves.toEqual(emptySavedOpenCodeStateSnapshot())
  })

  it("parses saved project directories and session references from desktop state files", async () => {
    const appDataDirectory = path.join(tempDir, "desktop-state")
    await fs.mkdir(appDataDirectory, { recursive: true })

    const globalState = {
      "globalSync.project": JSON.stringify({
        value: [
          { worktree: "D:\\Code\\alpha" },
          { worktree: "D:\\Code\\beta" },
        ],
      }),
      server: JSON.stringify({
        projects: {
          local: [{ worktree: "D:\\Code\\gamma" }],
        },
      }),
      "layout.page": JSON.stringify({
        lastProjectSession: {
          "D:\\Code\\beta": {
            directory: "D:\\Code\\beta",
            id: "ses_layout",
            at: 200,
          },
        },
      }),
      notification: JSON.stringify({
        list: [
          {
            directory: "D:\\Code\\delta",
            session: "ses_notification",
            time: 300,
          },
        ],
      }),
      layout: JSON.stringify({
        sessionTabs: {
          "RDpcQ29kZVxlcHNpbG9u/ses_tab": {},
        },
      }),
      permission: JSON.stringify({
        autoAccept: {
          "RDpcQ29kZVx6ZXRh/ses_permission": true,
          "RDpcQ29kZVxvbWVnYQ/*": true,
        },
      }),
    }

    await fs.writeFile(path.join(appDataDirectory, "opencode.global.dat"), JSON.stringify(globalState))
    await fs.writeFile(
      path.join(appDataDirectory, "opencode.workspace.sample.dat"),
      JSON.stringify({
        "session:ses_workspace:prompt": "{}",
        "session:ses_workspace:comments": "{}",
      }),
    )

    const reader = new DesktopSavedStateReader({
      appDataDirectory,
      ttlMs: 0,
    })

    const snapshot = await reader.readSnapshot()

    expect(snapshot.projectDirectories).toEqual([
      "D:\\Code\\alpha",
      "D:\\Code\\beta",
      "D:\\Code\\delta",
      "D:\\Code\\epsilon",
      "D:\\Code\\gamma",
      "D:\\Code\\omega",
      "D:\\Code\\zeta",
    ])
    expect(snapshot.sessionReferences).toEqual(
      expect.arrayContaining([
        { id: "ses_layout", directory: "D:\\Code\\beta", updatedAt: 200 },
        { id: "ses_notification", directory: "D:\\Code\\delta", updatedAt: 300 },
        { id: "ses_tab", directory: "D:\\Code\\epsilon", updatedAt: null },
        { id: "ses_permission", directory: "D:\\Code\\zeta", updatedAt: null },
        { id: "ses_workspace", directory: null, updatedAt: null },
      ]),
    )
  })
})
