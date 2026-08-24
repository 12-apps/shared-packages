import type { RbacMessages } from './context';

/**
 * The en-US pack — a NAMED export a host passes by hand
 * (`messages: EN_US_RBAC_MESSAGES`), never a default. The filename is what
 * exempts this file from the copy-portability gate.
 *
 * The `governance` sentences stay deliberately non-specific about WHICH
 * permission or WHICH rule was violated, exactly as the Portuguese does. That
 * is a security property rather than a wording choice: a refusal that names the
 * missing grant tells a caller which one to go and acquire.
 */
export const EN_US_RBAC_MESSAGES: RbacMessages = {
  forbidden: 'You do not have permission for this action.',
  notAMember: 'That user is not part of the team.',
  memberNotFound: 'Member not found.',
  roleNotFound: 'Role not found.',
  duplicateRoleName: 'A role with that name already exists.',
  reservedRoleName: 'That name is reserved for a system role. Edit the system role instead.',
  lastOwner: 'At least one owner must remain.',
  onlyOwnerRemovesOwner: 'Only an owner can remove another owner.',
  ownerNotDisableable: 'An owner cannot be disabled.',
  templateNotEditable: 'This system role cannot be edited.',
  invalidEmail: 'Enter a valid e-mail address.',
  invalidBody: 'Invalid data',
  notFound: 'Not found.',
  invitesNotConfigured: 'Invitations are not configured.',
  unauthenticated: 'Not authenticated.',
  baseRoleNotAssignable: 'This role cannot be set as the primary role.',
  governance: {
    escalation: 'You cannot grant a role holding permissions you do not have yourself.',
    scopeCeiling: 'This role cannot be assigned at this level of access.',
    separationOfDuties: 'This role breaks separation of duties and cannot be assigned.',
    ownerProtected: 'This role is protected and cannot be assigned here.',
    unknownRole: 'Unknown role.',
    fallback: 'This role could not be assigned.',
  },
};
