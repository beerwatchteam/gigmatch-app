import { isValidACN } from './acn';

export type LegalEntityType = 'Sole trader' | 'Company' | 'Partnership' | 'Trust' | 'Association / club' | '';

export type LegalIdentity = {
  entityType: LegalEntityType;
  legalName: string;
  acn: string;
  signatoryName: string;
  signatoryRole: string;
  addressLine: string;
  suburb: string;
  state: string;
  postcode: string;
  updatedAt?: number;
};

export const BLANK_LEGAL: LegalIdentity = {
  entityType: '',
  legalName: '',
  acn: '',
  signatoryName: '',
  signatoryRole: '',
  addressLine: '',
  suburb: '',
  state: '',
  postcode: '',
};

/**
 * Returns true when the legal identity document has enough information to
 * be used in a gig contract:
 *   - legalName, signatoryName, signatoryRole, addressLine, suburb, state, postcode all filled
 *   - If entityType is Company, a valid ACN is also required
 */
export function isLegalIdentityComplete(identity: LegalIdentity): boolean {
  const { legalName, signatoryName, signatoryRole, addressLine, suburb, state, postcode, entityType, acn } = identity;

  if (!legalName.trim()) return false;
  if (!signatoryName.trim()) return false;
  if (!signatoryRole.trim()) return false;
  if (!addressLine.trim()) return false;
  if (!suburb.trim()) return false;
  if (!state.trim()) return false;
  if (!postcode.trim()) return false;

  if (entityType === 'Company') {
    if (!acn.trim() || !isValidACN(acn.replace(/\s/g, ''))) return false;
  }

  return true;
}
