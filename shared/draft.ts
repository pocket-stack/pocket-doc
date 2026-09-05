export const SOURCE_WINDOW_CHARS = 512;
export const SOURCE_EDIT_CHARS = 768;
export type SourceDraft = {
  token: string; revision: string; seq: number; start: number; end: number; text: string;
  first: number; totalRows: number; chars: number; stagedDirty: boolean; undo: number; redo: number;
};
export type DraftPatch = { start: number; end: number; text: string };
export type DraftSeek = { token: string; seq: number; op: string; patch?: DraftPatch; row?: number; offset?: number; history?: -1 | 1 };
