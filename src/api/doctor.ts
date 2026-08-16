import { graphql } from './client';

/** What a configuration check concluded. */
export type DoctorVerdict = 'OK' | 'WARN' | 'FAIL';

/**
 * One thing checked about how this installation is configured.
 *
 * Not the same question monitoring asks. Monitoring answers "can it reach things";
 * everything can be reachable while the installation is still broken — an encryption
 * key read on first use means a server with none starts perfectly, reports itself
 * healthy, and fails the first time somebody saves a credential.
 */
export interface DoctorCheck {
  name: string;
  verdict: DoctorVerdict;
  /** One sentence: what is true, and what to do where something is not. */
  detail: string;
}

export async function fetchDoctor(): Promise<DoctorCheck[]> {
  const data = await graphql<{ doctor: DoctorCheck[] }>('query Doctor { doctor { name verdict detail } }');
  return data.doctor;
}

export const VERDICT_LABEL: Record<DoctorVerdict, string> = {
  OK: 'ok',
  WARN: 'check',
  FAIL: 'fail',
};
