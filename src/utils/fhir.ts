/**
 * FHIR Utility Functions
 */

import { Bundle, FhirResource, OperationOutcome } from '../types/fhir';

/**
 * Create a FHIR Bundle from an array of resources
 */
export function createBundle(
  resources: FhirResource[],
  type: Bundle['type'] = 'searchset',
  total?: number
): Bundle {
  return {
    resourceType: 'Bundle',
    type,
    total: total ?? resources.length,
    entry: resources.map(resource => ({
      fullUrl: `${resource.resourceType}/${resource.id}`,
      resource
    }))
  };
}

/**
 * Create an operation outcome for errors
 */
export function createOperationOutcome(
  severity: 'fatal' | 'error' | 'warning' | 'information',
  code: string,
  details: string
): OperationOutcome {
  return {
    resourceType: 'OperationOutcome',
    issue: [{
      severity,
      code,
      details: {
        text: details
      }
    }]
  };
}

/**
 * Validate FHIR resource structure
 */
export function validateFhirResource(resource: any): boolean {
  if (!resource || typeof resource !== 'object') {
    return false;
  }

  if (!resource.resourceType || typeof resource.resourceType !== 'string') {
    return false;
  }

  return true;
}

/**
 * Generate a FHIR-compliant timestamp
 */
export function getFhirTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Parse query parameters for FHIR search
 */
export function parseSearchParams(query: Record<string, any>): {
  searchParams: Record<string, any>;
  paginationParams: { _count?: number; _offset?: number };
} {
  const searchParams: Record<string, any> = {};
  const paginationParams: { _count?: number; _offset?: number } = {};

  for (const [key, value] of Object.entries(query)) {
    if (key === '_count') {
      const count = parseInt(value as string, 10);
      if (!isNaN(count) && count > 0 && count <= 100) {
        paginationParams._count = count;
      }
    } else if (key === '_offset') {
      const offset = parseInt(value as string, 10);
      if (!isNaN(offset) && offset >= 0) {
        paginationParams._offset = offset;
      }
    } else {
      searchParams[key] = value;
    }
  }

  return { searchParams, paginationParams };
}