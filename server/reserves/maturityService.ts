/**
 * Carrier Maturity Service
 * Implements Section 5 of the Chargebacks & Rolling Reserve Policy:
 * vendor chargeback maturity periods by carrier and cancellation type.
 *
 * Optimum: Voluntary Cancellation – 120 days; Non-Pay Disconnect – 180 days.
 * Astound: Voluntary Cancellation – 120 days; Non-Pay Disconnect – 120 days.
 */

/**
 * Returns the maturity period in days for a given carrier and chargeback type.
 * Per Policy Section 5 — Vendor Chargeback Maturity Periods.
 */
export function getMaturityDays(
  providerName: string,
  chargebackType: 'VOLUNTARY_CANCELLATION' | 'NON_PAY_DISCONNECT'
): number {
  const provider = providerName.toLowerCase();

  if (provider.includes('optimum') || provider.includes('altice')) {
    return chargebackType === 'VOLUNTARY_CANCELLATION' ? 120 : 180;
  }
  if (provider.includes('astound')) {
    return 120;
  }
  return 180;
}

/**
 * Calculates the maturity expiration date for an order.
 * Per Policy Section 5: commissions are not fully vested until the
 * applicable vendor chargeback maturity period has expired.
 */
export function calculateMaturityDate(
  dateSold: string,
  providerName: string,
  chargebackType: 'VOLUNTARY_CANCELLATION' | 'NON_PAY_DISCONNECT' = 'VOLUNTARY_CANCELLATION'
): Date {
  const days = getMaturityDays(providerName, chargebackType);
  const saleDate = new Date(dateSold);
  saleDate.setDate(saleDate.getDate() + days);
  return saleDate;
}

/**
 * Checks whether ALL possible maturity periods have expired for an order.
 * Uses the longest period for the carrier to ensure full coverage.
 * Per Policy Section 7: reserve is held through full applicable maturity periods.
 */
export function isOrderMature(
  dateSold: string,
  providerName: string
): boolean {
  const longestMaturity = calculateMaturityDate(
    dateSold,
    providerName,
    'NON_PAY_DISCONNECT'
  );
  return new Date() > longestMaturity;
}
