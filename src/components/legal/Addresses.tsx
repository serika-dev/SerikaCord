/**
 * Serika Company's postal addresses for the legal pages (Terms, Privacy
 * Policy). Written the Dutch way and never translated; the labels around them
 * are translated by each page.
 */

export function LegalAddress() {
  return (
    <address className="mt-1 not-italic">
      Serika Company
      <br />
      Box C0562
      <br />
      Verdunplein 17
      <br />
      5627SZ Eindhoven
      <br />
      Nederland
    </address>
  );
}

/** Where parcels go (not the legal address). */
export function ParcelAddress() {
  return (
    <address className="mt-1 not-italic">
      Serika Company
      <br />
      Weteringweg 18
      <br />
      2641KM Pijnacker
      <br />
      Nederland
    </address>
  );
}
