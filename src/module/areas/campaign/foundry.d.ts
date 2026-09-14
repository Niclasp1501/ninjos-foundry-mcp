/**
 * The Foundry documents the campaign area works with, narrowed from the loose core
 * declarations and from the journal types of the journals area. A global script:
 * no import, no export.
 */

/** A journal with the flags the dashboard reads: its structure and the saved status per part. */
interface FoundryCampaignJournal extends FoundryJournalsEntry {
  flags?: Record<string, Record<string, unknown> | undefined>;
}

/** An actor, as far as linking a quest to it needs. */
interface FoundryCampaignActor extends FoundryDocument {
  name: string;
}

/**
 * What a render hook hands over. ApplicationV2 sheets (Foundry 13 and later)
 * carry `document`; the older journal sheets carry `object`.
 */
interface FoundryCampaignSheet {
  document?: FoundryDocument | null;
  object?: FoundryDocument | null;
}
