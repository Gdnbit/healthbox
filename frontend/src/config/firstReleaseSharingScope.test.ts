import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getNavigationSections } from './navigation.config';
import { buildEntityUrl } from '../utils/entityNavigation';
import { ENTITY_TYPES } from '../utils/entityRelationships';
import {
  PRODUCT_HOME_PATH,
  RETIRED_MEMBER_ROUTE_PATHS,
  resolveProductReturnPath,
} from './productRoutes';

const sourcePath = (relativePath: string) =>
  resolve(process.cwd(), 'src', relativePath);

const appSource = readFileSync(sourcePath('App.jsx'), 'utf8');
const householdHomeSource = readFileSync(
  sourcePath('pages/HouseholdHealthHome.tsx'),
  'utf8'
);
const legacyFamilyHistorySource = readFileSync(
  sourcePath('pages/medical/FamilyHistory.jsx'),
  'utf8'
);

const ordinaryNavigationPaths = Object.values(
  getNavigationSections('desktop', false)
).flatMap(section => section.items.map(item => item.path));

describe('first-release reciprocal sharing UI boundary', () => {
  it('retires every legacy member route at the product boundary', () => {
    expect(RETIRED_MEMBER_ROUTE_PATHS).toEqual(['/family-history']);

    for (const path of RETIRED_MEMBER_ROUTE_PATHS) {
      expect(resolveProductReturnPath(path)).toBe(PRODUCT_HOME_PATH);
      expect(resolveProductReturnPath(`${path}?share=legacy`)).toBe(
        PRODUCT_HOME_PATH
      );
    }
  });

  it('does not expose the directional-sharing page in the ordinary navigation', () => {
    expect(ordinaryNavigationPaths).not.toContain('/family-history');
    expect(ordinaryNavigationPaths).not.toContain('/invitations');
    expect(ordinaryNavigationPaths).toContain(PRODUCT_HOME_PATH);
  });

  it('does not recreate the retired route through generic entity navigation', () => {
    const relatedFamilyMemberUrl = buildEntityUrl(
      ENTITY_TYPES.FAMILY_MEMBER,
      42,
      { autoOpen: true }
    );

    expect(relatedFamilyMemberUrl).toBe(`${PRODUCT_HOME_PATH}?view=42`);
    expect(relatedFamilyMemberUrl).not.toContain('/family-history');
  });

  it('keeps the legacy family-history page outside the production route graph', () => {
    expect(legacyFamilyHistorySource).toContain('FamilyHistorySharingModal');
    expect(legacyFamilyHistorySource).toContain('InvitationManager');
    expect(appSource).not.toContain(
      "import FamilyHistory from './pages/medical/FamilyHistory'"
    );
    expect(appSource).not.toContain(
      '[ENTITY_TYPES.FAMILY_MEMBER]: FamilyHistory'
    );
    expect(appSource).toContain('RETIRED_MEMBER_ROUTE_PATHS.map');
  });

  it('keeps the household workspace free of legacy sharing modules', () => {
    expect(householdHomeSource).not.toMatch(
      /FamilyHistorySharingModal|InvitationManager|InvitationNotifications|PatientSharingModal/
    );
  });
});
