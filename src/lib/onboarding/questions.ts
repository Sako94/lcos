/**
 * Client onboarding questionnaire, version 1.
 *
 * Each question maps to a Source of Truth category. On review, an answer is promoted into a Proposed fact
 * in that category, with `fact` as the default statement prefix. Changing questions in a way that changes
 * meaning: bump QUESTIONNAIRE_VERSION (forms record the version they were sent with).
 */

export const QUESTIONNAIRE_VERSION = 1;

export type QuestionType = "short" | "long" | "single" | "multi" | "links";

export type Question = {
  key: string;
  label: string;
  help?: string;
  placeholder?: string;
  type: QuestionType;
  options?: string[];
  required?: boolean;
  category: string; // app.fact_category
  fact: string; // default statement prefix when promoted
};

export type Section = { key: string; title: string; intro: string; questions: Question[] };

export const SECTIONS: Section[] = [
  {
    key: "business",
    title: "Your business",
    intro: "The big picture: what you sell, where revenue comes from, and what the next 90 days need to deliver.",
    questions: [
      { key: "brand_summary", type: "long", required: true, category: "business_objective", fact: "Brand summary",
        label: "In a sentence or two: what do you sell, who is it for, and why do people choose you over the alternatives?" },
      { key: "goals_90d", type: "long", required: true, category: "business_objective", fact: "90-day goals",
        label: "What are your top 3 goals for the next 90 days?",
        placeholder: "e.g. grow repeat revenue, launch the new collection, rebuild the welcome series" },
      { key: "channel_mix", type: "long", category: "business_objective", fact: "Revenue by channel",
        label: "Roughly how does revenue split across channels, and how much comes from email and SMS today?",
        help: "Your site, Amazon, wholesale, retail. Ballpark percentages are fine." },
      { key: "economics", type: "long", category: "pricing_economics", fact: "Unit economics",
        label: "Average order value, gross margin range and repeat purchase rate, if you know them." },
      { key: "seasonality", type: "long", category: "business_objective", fact: "Seasonality",
        label: "Which are your busiest and slowest months? Anything seasonal we should plan around?" },
    ],
  },
  {
    key: "customer",
    title: "Your customer",
    intro: "Who buys, why they hesitate, and why they come back (or don't).",
    questions: [
      { key: "customer_profiles", type: "long", required: true, category: "customer_audience", fact: "Customer profiles",
        label: "Describe your main customer, and a second one if you have one.",
        help: "Age, lifestyle, what triggers them to buy." },
      { key: "objections", type: "long", category: "customer_audience", fact: "Pre-purchase objections",
        label: "What are the top 3 hesitations people have before their first purchase?" },
      { key: "why_return", type: "long", category: "customer_audience", fact: "Why customers come back",
        label: "Why do customers come back and buy again?" },
      { key: "why_churn", type: "long", category: "customer_audience", fact: "Churn and return reasons",
        label: "Why do customers stop buying or return items?" },
      { key: "support_themes", type: "long", category: "customer_audience", fact: "Common support questions",
        label: "What does your support team get asked every day?" },
      { key: "review_sources", type: "links", category: "assets_references", fact: "Reviews, surveys and UGC",
        label: "Links to reviews, surveys or customer content we can learn from.", placeholder: "One link per line" },
    ],
  },
  {
    key: "products",
    title: "Products",
    intro: "Where customers start, what they buy next, and what's coming.",
    questions: [
      { key: "hero_products", type: "long", required: true, category: "products_launches", fact: "Hero and entry products",
        label: "What are your hero products, and which ones do most new customers buy first?" },
      { key: "second_purchase", type: "long", category: "products_launches", fact: "Best second purchase",
        label: "What's the best second purchase, and how do customers usually move between categories?" },
      { key: "replenishment", type: "long", category: "products_launches", fact: "Replenishment cycles",
        label: "For anything consumable: how long does it usually last before a customer runs out?",
        placeholder: "e.g. 30-day supply, most reorder around day 25" },
      { key: "launches", type: "long", category: "products_launches", fact: "Upcoming launches and restocks",
        label: "Launches, restocks and drops planned for the next 6 months, with rough dates." },
      { key: "dont_push", type: "long", category: "constraints_rules", fact: "Products not to push",
        label: "Any products we shouldn't push (low stock, low margin, being discontinued)?" },
    ],
  },
  {
    key: "offers",
    title: "Offers and policies",
    intro: "How you think about discounts, and the rules we should never break.",
    questions: [
      { key: "discount_stance", type: "single", required: true, category: "offers_discounts", fact: "Discount stance",
        label: "How do you feel about discounting?",
        options: ["We avoid discounts", "Occasional promotions only", "Regular promotions are fine", "Promotions drive most of our sales"] },
      { key: "discount_limits", type: "long", required: true, category: "offers_discounts", fact: "Discount limits",
        label: "What's the deepest discount you're comfortable with, and what's off-limits?",
        placeholder: "e.g. max 20% sitewide, never discount new launches, no stacking codes" },
      { key: "welcome_offer", type: "short", category: "offers_discounts", fact: "Current welcome offer",
        label: "What is your current welcome offer?" },
      { key: "programs", type: "multi", category: "offers_discounts", fact: "Retention programs",
        label: "Which of these do you run?", options: ["Loyalty / rewards", "Referral program", "Subscriptions", "Bundles", "None of these"] },
      { key: "programs_apps", type: "short", category: "platforms_access", fact: "Retention program apps",
        label: "Which apps run them?", placeholder: "e.g. Smile.io, Recharge, Skio" },
      { key: "shipping_returns", type: "long", category: "offers_discounts", fact: "Shipping and returns",
        label: "Free shipping threshold and return policy." },
      { key: "sales_calendar", type: "long", category: "offers_discounts", fact: "Sales calendar",
        label: "Your sales calendar: BFCM, anniversary, and any moments specific to your brand." },
    ],
  },
  {
    key: "brand",
    title: "Brand and creative",
    intro: "How you sound, what you look like, and what we must never say.",
    questions: [
      { key: "voice_is", type: "short", required: true, category: "brand_voice", fact: "Voice is",
        label: "Three words that describe your brand voice." },
      { key: "voice_isnt", type: "short", category: "brand_voice", fact: "Voice is never",
        label: "Three words your brand should never sound like." },
      { key: "admired_brands", type: "long", category: "brand_voice", fact: "Admired brands",
        label: "2–3 brands whose emails or texts you admire, and why." },
      { key: "avoid_claims", type: "long", required: true, category: "claims_compliance", fact: "Words, claims and topics to avoid",
        label: "Words, claims or topics we must avoid.",
        help: "Legal, medical and competitor claims matter most, especially for supplements and wellness." },
      { key: "brand_guidelines", type: "links", category: "assets_references", fact: "Brand guidelines",
        label: "Link to brand guidelines, logos, fonts and colors.", placeholder: "One link per line" },
      { key: "asset_library", type: "links", category: "assets_references", fact: "Asset library",
        label: "Where do photos, video and UGC live? Please share a link with access for the Wavy team.",
        placeholder: "Google Drive, Dropbox, Frame.io…" },
      { key: "founder_availability", type: "single", category: "brand_voice", fact: "Founder availability for personal sends",
        label: "Can the founder or face of the brand sign or appear in some sends?",
        options: ["Yes, regularly", "Occasionally", "No"] },
    ],
  },
  {
    key: "program",
    title: "Your email and SMS today",
    intro: "Your view of what's running now. We'll confirm the details in our own audit, so best guesses are fine.",
    questions: [
      { key: "working", type: "long", category: "business_objective", fact: "What's working and what isn't",
        label: "What's working, what isn't, and what have you already tried?" },
      { key: "current_flows", type: "long", category: "platforms_access", fact: "Live flows (client view)",
        label: "Which automated flows do you believe are live, and who built them?" },
      { key: "cadence", type: "short", category: "lists_segments_consent", fact: "Current send cadence",
        label: "How often do you send campaigns today?", placeholder: "e.g. 3 emails and 1 SMS a week" },
      { key: "deliverability", type: "long", category: "lists_segments_consent", fact: "Deliverability history",
        label: "Any past deliverability problems, spam complaints or list cleanups?" },
      { key: "migrations", type: "short", category: "platforms_access", fact: "Recent platform migrations",
        label: "Have you switched email or SMS platforms recently?" },
    ],
  },
  {
    key: "stack",
    title: "Tools and access",
    intro: "What you use, and what access the Wavy team needs.",
    questions: [
      { key: "esp", type: "single", required: true, category: "platforms_access", fact: "Email platform",
        label: "Email platform", options: ["Klaviyo", "Omnisend", "Mailchimp", "Other"] },
      { key: "sms_platform", type: "single", required: true, category: "platforms_access", fact: "SMS platform",
        label: "SMS platform", options: ["Klaviyo SMS", "Attentive", "Postscript", "One Text", "Other", "We don't send SMS yet"] },
      { key: "other_tools", type: "long", category: "platforms_access", fact: "Other tools in the stack",
        label: "Other tools we should know about.",
        help: "Reviews, loyalty, subscriptions, helpdesk, popups and forms, quizzes." },
      { key: "access_granted", type: "multi", category: "platforms_access", fact: "Access granted to Wavy",
        label: "Which access have you already given the Wavy team?",
        options: ["Email platform", "SMS platform", "Shopify (collaborator)", "Reviews app", "Asset library", "None yet"] },
      { key: "dns_contact", type: "short", category: "stakeholders", fact: "DNS contact",
        label: "Who can make DNS changes for your sending domain?", placeholder: "Name and email" },
      { key: "custom_integrations", type: "long", category: "platforms_access", fact: "Custom integrations",
        label: "Any custom integrations or events (quiz, app, wholesale portal)?" },
    ],
  },
  {
    key: "together",
    title: "Working together",
    intro: "Who we work with, who signs off, and what success looks like.",
    questions: [
      { key: "primary_contact", type: "short", required: true, category: "stakeholders", fact: "Primary contact",
        label: "Primary contact", placeholder: "Name, role, email" },
      { key: "final_approver", type: "short", required: true, category: "stakeholders", fact: "Final approver",
        label: "Who gives final approval on emails and texts?", placeholder: "Name, role, email" },
      { key: "reviewers", type: "long", category: "stakeholders", fact: "Other reviewers",
        label: "Anyone else who needs to see work before it goes live (legal, founder, ops)?" },
      { key: "turnaround", type: "single", category: "stakeholders", fact: "Approval turnaround",
        label: "How quickly can you usually turn around approvals?", options: ["Same day", "Within 24 hours", "Within 48 hours", "Longer"] },
      { key: "comms_channel", type: "single", category: "stakeholders", fact: "Preferred channel",
        label: "Where do you prefer to talk day to day?", options: ["Slack Connect", "Email", "Either"] },
      { key: "meeting_cadence", type: "single", category: "stakeholders", fact: "Meeting cadence",
        label: "How often would you like a meeting?", options: ["Weekly", "Every two weeks", "Monthly"] },
      { key: "success", type: "long", required: true, category: "business_objective", fact: "Success at 30/60/90 days",
        label: "What does success look like at 30, 60 and 90 days?" },
      { key: "past_agency", type: "long", category: "constraints_rules", fact: "Lessons from past agencies",
        label: "Anything that went wrong with past agencies that you want us to avoid?" },
    ],
  },
];

export const QUESTIONS: Question[] = SECTIONS.flatMap((s) => s.questions);
export const QUESTION_BY_KEY = new Map(QUESTIONS.map((q) => [q.key, q]));
export const SECTION_BY_QUESTION = new Map(SECTIONS.flatMap((s) => s.questions.map((q) => [q.key, s.key] as const)));

export type AnswerValue = string | string[];

export function isAnswered(v: AnswerValue | undefined): boolean {
  if (v === undefined) return false;
  return Array.isArray(v) ? v.length > 0 : v.trim() !== "";
}

export function answerText(v: AnswerValue): string {
  return Array.isArray(v) ? v.join(", ") : v.trim();
}

/** Default fact statement when an answer is promoted into the Source of Truth. */
export function defaultStatement(q: Question, v: AnswerValue): string {
  return `${q.fact} (client-stated): ${answerText(v)}`;
}

export function missingRequired(answers: Record<string, AnswerValue>): Question[] {
  return QUESTIONS.filter((q) => q.required && !isAnswered(answers[q.key]));
}
