/** Same parent identity for both the counter and the expanded announcement cards. */
export function announcementKey(listing: any): string {
  const family = listing.rawData?.family_id;
  return `${listing.marketplaceAccountId}:${family ? `family:${family}` : `item:${listing.itemId || listing.id}`}`;
}

export function countAnnouncements(links: any[]): number {
  return new Set((links ?? []).filter(link => link.listing).map(link => announcementKey(link.listing))).size;
}
