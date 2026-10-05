// Leave room for the restore request envelope below Vercel's 4.5 MB request limit.
export const MAX_TRAINING_EXPORT_BYTES = 4 * 1024 * 1024;
export const MAX_TRAINING_RESTORE_BYTES = MAX_TRAINING_EXPORT_BYTES + 16 * 1024;
