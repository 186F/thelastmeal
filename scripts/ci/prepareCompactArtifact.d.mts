export declare const COMPACT_BUDGET_BYTES: number;
export declare function selectCompactFiles(files: { path: string; bytes: number }[]): {
  included: { path: string; bytes: number }[];
  conflicts: string[];
};
export declare function buildCompactArtifact(repoRoot: string): {
  profile: string;
  budgetBytes: number;
  totalBytes: number;
  withinBudget: boolean;
  fileCount: number;
  files: { path: string; bytes: number }[];
  note: string;
};
export declare const FULL_BUDGET_BYTES: number;
export interface FullSequenceDescriptor {
  name: string;
  archivePath: string | null;
  archiveFiles: { path: string; bytes: number }[];
  treeFiles: { path: string; bytes: number }[];
  controlFiles: { path: string; bytes: number }[];
}
export declare function selectFullPayloads(sequences: FullSequenceDescriptor[]): {
  included: { path: string; bytes: number }[];
  dispositions: { sequence: string; disposition: string }[];
};
export declare function buildFullArtifact(repoRoot: string): {
  profile: string;
  budgetBytes: number;
  totalBytes: number;
  withinBudget: boolean;
  fileCount: number;
  sequenceDispositions: { sequence: string; disposition: string }[];
  files: { path: string; bytes: number }[];
  note: string;
};
