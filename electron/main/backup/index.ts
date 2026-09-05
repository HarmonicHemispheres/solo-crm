/** The manual backup — one entry point for the IPC layer, so `registry.ts` imports a behaviour and not a file layout. */
export { backupFileName, runManualBackup } from './manual'
export type { BackupDialog, BackupWindowSource, ManualBackupDeps } from './manual'
