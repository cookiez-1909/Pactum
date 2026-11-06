// Sample comments for fictional incidents. All of it is made-up content to illustrate the discussion section.
export type Speaker = "owner" | "attacker" | "stranger" | { user: number };

export interface SeedComment {
  id: string;
  speaker: Speaker;
  ageMinutes: number;
  text: string;
}

export const SEED_COMMENTS: Record<string, SeedComment[]> = {
  kestrel: [
    { id: "k1", speaker: "owner", ageMinutes: 42, text: "We have published the offer. Keep 20% and return the rest within 48 hours. We will not try to contact you, and a full post-mortem follows either way." },
    { id: "k2", speaker: { user: 1 }, ageMinutes: 35, text: "Lost most of my position here. If this comes back I would still get 80%. Better than what usually happens after a bridge hack." },
    { id: "k3", speaker: "stranger", ageMinutes: 20, text: "Is 20% too generous? The holder could just take everything to a mixer. Curious what others think." },
    { id: "k4", speaker: { user: 2 }, ageMinutes: 12, text: "I would rather get 80% this week than nothing. The reward drops to 10% after two days, so there is a real reason to move fast." },
  ],
  tidewater: [
    { id: "t1", speaker: { user: 1 }, ageMinutes: 90, text: "Part of the USDC came back and I already claimed. It went straight to my wallet with no form to fill in." },
    { id: "t2", speaker: "stranger", ageMinutes: 55, text: "Anyone else watching the 15% tier expire? Only the USDC and ETH have moved so far." },
    { id: "t3", speaker: { user: 3 }, ageMinutes: 30, text: "My BTC has not moved. Is there anything I need to do, or does it appear in the refund tab when it comes back?" },
    { id: "t4", speaker: { user: 2 }, ageMinutes: 25, text: "Nothing to do. It shows up as available once funds return, and you can claim again each time more arrives." },
  ],
  northgate: [
    { id: "n1", speaker: "owner", ageMinutes: 300, text: "All funds are back. The reward cap applied, so more went to users than the 10% rate alone would give." },
    { id: "n2", speaker: { user: 1 }, ageMinutes: 240, text: "Claimed. Thanks to whoever pushed for the cap." },
  ],
  quillon: [
    { id: "q1", speaker: { user: 2 }, ageMinutes: 400, text: "The offer ended with only part of the ADA back. Can I still claim what did come back?" },
    { id: "q2", speaker: { user: 1 }, ageMinutes: 380, text: "Yes. Refunds stay claimable after the deadline. I claimed mine after it closed." },
  ],
  marlin: [
    { id: "m1", speaker: { user: 1 }, ageMinutes: 60, text: "No offer yet. Does anyone know when the team plans to publish one? The funds have not moved." },
    { id: "m2", speaker: "stranger", ageMinutes: 40, text: "Every hour without terms makes a return less likely. They should publish soon." },
  ],
};
