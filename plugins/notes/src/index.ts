export * from "./types.js"
export {
  NotesService,
  createNotesService,
  type NotesServiceOptions,
} from "./service.js"
export {
  FileNotesStore,
  MemoryNotesStore,
  compareNotes,
  parseAttachment,
  parseNote,
  parseSnapshot,
  parseSpace,
  type FileNotesStoreOptions,
  type NotesStore,
} from "./store.js"
export {
  DIRECTORY_MODE,
  FILE_MODE,
  resolveDataDir,
  resolveEngineDbPath,
} from "./fs-utils.js"
export {
  MIGRATION_FILE,
  migrateEngineData,
  migrationMarkerPath,
  readMigrationMarker,
  type MigrationMarker,
  type MigrationOptions,
} from "./core/migrate.js"
