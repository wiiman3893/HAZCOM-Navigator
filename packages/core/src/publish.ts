export interface PublishedAttachment {
  attachmentId: string;
  ownerType: string;
  ownerId: string;
  slotKey?: string | null;
  relativePath: string;
  sha256: string;
  sizeBytes: number;
}

export interface PublishedRevisionManifest {
  schemaVersion: number;
  companyId: string;
  revisionId: string;
  createdAt: string;
  createdByAccountId: string;
  parentRevisionId?: string | null;
  recordCounts: Record<string, number>;
  attachments: PublishedAttachment[];
}

export function assertRevisionBelongsToActiveCompany(activeCompanyId: string, manifest: PublishedRevisionManifest): void {
  if (manifest.companyId !== activeCompanyId) {
    throw new Error('Published revision does not belong to the active Company context.');
  }
}
