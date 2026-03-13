import { create } from "zustand"

export type ApprovalItem = {
  sessionId: string
  permissionId: string
  permission: string
  patterns: string[]
}

type InboxState = {
  approvals: ApprovalItem[]
  upsertApproval: (approval: ApprovalItem) => void
  resolveApproval: (permissionId: string) => void
  clear: () => void
}

export const useInboxStore = create<InboxState>((set) => ({
  approvals: [],
  upsertApproval(approval) {
    set((state) => ({
      approvals: [approval, ...state.approvals.filter((item) => item.permissionId !== approval.permissionId)],
    }))
  },
  resolveApproval(permissionId) {
    set((state) => ({
      approvals: state.approvals.filter((item) => item.permissionId !== permissionId),
    }))
  },
  clear() {
    set({ approvals: [] })
  },
}))
