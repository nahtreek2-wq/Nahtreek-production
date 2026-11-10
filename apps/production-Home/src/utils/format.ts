import {IndiaLocale} from '@nahtreek/design-system';

/** Server amounts arrive in paisa; display goes through the shared formatter. */
export function inr(paisa: number): string {
  return IndiaLocale.formatCurrency(Math.round(paisa / 100));
}

export function inrMonth(paisa: number): string {
  return `${inr(paisa)}/month`;
}

/** Reviews render verbatim in cards: collapse blank-line floods and padding
 *  spaces so one paste cannot break every profile that shows it. */
export function cleanReviewComment(value: string): string {
  return value
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
